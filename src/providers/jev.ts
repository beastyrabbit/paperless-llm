import { z } from "zod";
import type { Config } from "../config/index.js";
import { fetchJson } from "../util.js";

const probability = z.number().min(0).max(1);
export const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative().optional().default(0),
    cost: z.number().nonnegative().optional(),
  })
  .passthrough();
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(z.string(), probability),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().nonnegative(),
    confidence: probability,
    legend: z.record(z.string(), z.unknown()),
    probabilities: z.record(z.string(), probability),
  }),
]);
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: usageSchema,
});
export type Usage = z.infer<typeof usageSchema>;
export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };
export interface Decision<T> {
  value: T;
  confidence: number;
  usage: Usage;
}
export class JevClient {
  constructor(
    readonly config: Config["jev"],
    private readonly key: string,
    private readonly request: typeof fetch = fetch,
    private readonly account: (usage: Usage) => void = () => {},
  ) {}
  withAccounting(account: (usage: Usage) => void) {
    return new JevClient(this.config, this.key, this.request, account);
  }
  async ask(state: string, question: JevQuestion) {
    if (
      question.type === "choice" &&
      (Object.keys(question.criteria).length > 255 || !Object.keys(question.criteria).length)
    ) {
      throw new Error("Jev choice requires 1..255 options");
    }
    if (question.type === "score" && (!question.criteria.length || question.criteria.length > 10)) {
      throw new Error("Jev score requires 1..10 rubric levels");
    }
    const response = responseSchema.parse(
      await fetchJson(
        this.request,
        this.config.apiBaseUrl,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            state,
            questions: { result: question },
          }),
        },
        "Jev",
      ),
    );
    this.account(response.usage);
    const answer = response.answers.result;
    if (!answer || answer.type !== question.type || Object.keys(response.answers).length !== 1)
      throw new Error("Jev answer does not match question");
    if (
      answer.type === "choice" &&
      question.type === "choice" &&
      !(answer.choice in question.criteria)
    )
      throw new Error("Jev returned an unknown choice");
    if (
      answer.type === "score" &&
      question.type === "score" &&
      answer.score > question.criteria.length - 1
    )
      throw new Error("Jev score outside rubric");
    return { answer, usage: response.usage };
  }
  async choice(
    state: string,
    instructions: string,
    criteria: Record<string, string>,
  ): Promise<Decision<string>> {
    const { answer, usage } = await this.ask(state, { type: "choice", instructions, criteria });
    if (answer.type !== "choice") throw new Error("Expected choice");
    return { value: answer.choice, confidence: answer.confidence, usage };
  }
  async noul(state: string, instructions: string): Promise<Decision<boolean>> {
    const { answer, usage } = await this.ask(state, { type: "noul", instructions });
    if (answer.type !== "noul") throw new Error("Expected noul");
    return { value: answer.noul >= 0.5, confidence: Math.max(answer.noul, 1 - answer.noul), usage };
  }
  async score(state: string, instructions: string, criteria: string[]): Promise<Decision<number>> {
    const { answer, usage } = await this.ask(state, { type: "score", instructions, criteria });
    if (answer.type !== "score") throw new Error("Expected score");
    return { value: answer.score, confidence: answer.confidence, usage };
  }
}
