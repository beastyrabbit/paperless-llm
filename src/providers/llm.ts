import { z } from "zod";
import type { Config, Route, Secrets } from "../config/index.js";
import { endpoint, fetchJson } from "../util.js";

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});
export class LlmClient {
  constructor(
    readonly config: Config["llm"],
    private readonly secrets: Secrets,
    private readonly request: typeof fetch = fetch,
    private readonly account: (usage: unknown) => void = () => {},
  ) {}
  withAccounting(account: (usage: unknown) => void) {
    return new LlmClient(this.config, this.secrets, this.request, account);
  }
  async extractStructured<T>(
    schema: z.ZodType<T>,
    systemPrompt: string,
    userPrompt: string,
    route: Route = this.config.defaultProvider,
  ): Promise<T> {
    const target = this.config[route];
    const key = route === "local" ? this.secrets.localLlmApiKey : this.secrets.llmApiKey;
    if (route === "cloud" && !key) throw new Error("LLM_API_KEY is required for cloud extraction");
    const messages = [
      {
        role: "system",
        content:
          systemPrompt +
          "\nReturn only JSON matching this schema:\n" +
          JSON.stringify(z.toJSONSchema(schema)),
      },
      { role: "user", content: userPrompt },
    ];
    for (let attempt = 0; attempt <= this.config.maxJsonRepairRetries; attempt++) {
      const response = completionSchema.parse(
        await fetchJson(
          this.request,
          endpoint(target.baseUrl, "/chat/completions"),
          {
            method: "POST",
            headers: {
              ...(key ? { Authorization: `Bearer ${key}` } : {}),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: target.model,
              messages,
              response_format: { type: "json_object" },
            }),
          },
          "LLM",
        ),
      );
      this.account(response.usage ?? {});
      const content = response.choices[0]?.message.content ?? "";
      try {
        return schema.parse(JSON.parse(content));
      } catch {
        if (attempt === this.config.maxJsonRepairRetries)
          throw new Error("LLM returned invalid structured JSON");
        messages.push(
          { role: "assistant", content },
          {
            role: "user",
            content:
              "Repair the previous JSON to match the schema exactly. Do not add facts or new values.",
          },
        );
      }
    }
    throw new Error("Structured extraction failed");
  }
}
