import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JevClient } from "../src/providers/jev.js";
import { LlmClient } from "../src/providers/llm.js";
import { Fixture, respond } from "./helpers.js";

let fixture: Fixture;
afterEach(() => fixture?.close());
describe("Paperless 3.5.1 client", () => {
  it("scales the OCR timeout by reserved pages and caps it at ten minutes", async () => {
    fixture = new Fixture();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await fixture.ctx.mistral.ocr(Buffer.from("%PDF-"), 2);
    expect(timeout).toHaveBeenLastCalledWith(90_000);
    await fixture.ctx.mistral.ocr(Buffer.from("%PDF-"), 100);
    expect(timeout).toHaveBeenLastCalledWith(600_000);
    fixture.ctx.config.ocr.timeoutMs = 10_000;
    fixture.ctx.config.ocr.perPageTimeoutMs = 1000;
    await fixture.ctx.mistral.ocr(Buffer.from("%PDF-"), 2);
    expect(timeout).toHaveBeenLastCalledWith(12_000);
    timeout.mockRestore();
  });
  it("paginates without following third-party next URLs", async () => {
    fixture = new Fixture();
    fixture.pageSize = 1;
    expect(await fixture.ctx.paperless.listEntities("tag")).toHaveLength(5);
    expect(fixture.calls.every((call) => call.url.host === "paperless.test")).toBe(true);
  });
  it("uses delta tag mutation and preserves unrelated tags", async () => {
    fixture = new Fixture();
    await fixture.ctx.paperless.modifyTags(1, [11, 11], [10]);
    expect(fixture.docs.get(1)?.tags).toEqual([99, 11]);
    const call = fixture.calls.find((entry) => entry.url.pathname.endsWith("/bulk_edit/"));
    expect(call?.body).toEqual({
      documents: [1],
      method: "modify_tags",
      parameters: { add_tags: [11], remove_tags: [10] },
    });
    await expect(fixture.ctx.paperless.patchDocument(1, { tags: [] } as never)).rejects.toThrow(
      "Unsupported",
    );
  });
  it("preserves unrelated custom fields and rejects concurrent human edits", async () => {
    fixture = new Fixture();
    const doc = fixture.docs.get(1);
    if (!doc) throw new Error("fixture");
    doc.custom_fields = [
      { field: 999, value: "human" },
      { field: 101, value: "10.00" },
    ];
    await fixture.ctx.paperless.patchCustomFields(1, [
      { field: 101, value: "20.00", expected: "10.00" },
    ]);
    expect(doc.custom_fields).toContainEqual({ field: 999, value: "human" });
    await expect(
      fixture.ctx.paperless.patchCustomFields(1, [
        { field: 101, value: "30.00", expected: "10.00" },
      ]),
    ).rejects.toThrow("changed externally");
  });
  it("disables matching on created entities and detects competitors", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 8, name: "Native", matching_algorithm: 6 });
    const created = await fixture.ctx.paperless.createEntity("tag", "new");
    expect(created.matching_algorithm).toBe(0);
    expect(await fixture.ctx.paperless.findCompetingNativeMatchers()).toEqual([
      { id: 8, name: "Native", matching_algorithm: 6 },
    ]);
  });
  it("bounds labels before network requests and validates response schemas", async () => {
    fixture = new Fixture();
    await expect(fixture.ctx.paperless.labelVersion(1, 1, "x".repeat(65))).rejects.toThrow("64");
    expect(fixture.calls).toHaveLength(0);
    fixture.fail = () => respond({ id: "invalid" });
    await expect(fixture.ctx.paperless.getDocument(1)).rejects.toThrow();
  });
  it("handles failed tasks and never logs response bodies in errors", async () => {
    fixture = new Fixture();
    fixture.fail = (url) =>
      url.pathname.endsWith("/tasks/")
        ? respond([{ task_id: "bad", status: "FAILURE" }])
        : respond({ sensitive: "private-body" }, 503);
    await expect(fixture.ctx.paperless.pollTask("bad")).rejects.toThrow("failed");
    await expect(fixture.ctx.paperless.getDocument(1)).rejects.toThrow("HTTP 503");
    await expect(fixture.ctx.paperless.getDocument(1)).rejects.not.toThrow("private-body");
  });
});
describe("Jev", () => {
  it("parses choice, noul and score against the published named-answer contract", async () => {
    fixture = new Fixture();
    expect((await fixture.ctx.jev.choice("source", "pick", { a: "A", b: "B" })).value).toBe("a");
    expect((await fixture.ctx.jev.noul("source", "check")).value).toBe(true);
    expect((await fixture.ctx.jev.score("source", "rate", ["low", "high"])).value).toBe(1);
    expect(fixture.providerCalls("jev.test")[0]?.body).toMatchObject({
      model: "jev-latest",
      state: "source",
      questions: { result: { type: "choice" } },
    });
  });
  it("accepts confident negative noul decisions and records token/cost usage", async () => {
    fixture = new Fixture();
    fixture.jev = () => ({ type: "noul", noul: 0.01 });
    const account = vi.fn();
    const client = new JevClient(fixture.ctx.config.jev, "fixture", fixture.request, account);
    expect(await client.noul("source", "check")).toMatchObject({ value: false, confidence: 0.99 });
    expect(account).toHaveBeenCalledWith({ input_tokens: 100, output_tokens: 10, cost: 0.01 });
  });
  it("rejects excessive choices, invalid probabilities, and unknown answers", async () => {
    fixture = new Fixture();
    await expect(
      fixture.ctx.jev.choice(
        "x",
        "x",
        Object.fromEntries(Array.from({ length: 256 }, (_, index) => [index, "value"])),
      ),
    ).rejects.toThrow("255");
    expect(fixture.calls).toHaveLength(0);
    fixture.jev = () => ({ type: "noul", noul: 1.1 });
    await expect(fixture.ctx.jev.noul("x", "x")).rejects.toThrow();
    fixture.jev = () => ({
      type: "choice",
      choice: "unknown",
      confidence: 0.9,
      probabilities: { unknown: 1 },
    });
    await expect(fixture.ctx.jev.choice("x", "x", { yes: "yes" })).rejects.toThrow("unknown");
  });
});
describe("OpenAI-compatible structured extraction", () => {
  it("repairs invalid JSON at most once and records both calls", async () => {
    fixture = new Fixture();
    fixture.completions = ["not json", '{"value":42}'];
    const account = vi.fn();
    const client = new LlmClient(
      fixture.ctx.config.llm,
      { llmApiKey: "fixture" },
      fixture.request,
      account,
    );
    expect(
      await client.extractStructured(z.object({ value: z.number() }), "system", "source"),
    ).toEqual({ value: 42 });
    expect(account).toHaveBeenCalledTimes(2);
    expect(fixture.providerCalls("cloud.test")[1]?.body).toMatchObject({
      response_format: { type: "json_object" },
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("Repair") }),
      ]),
    });
  });
  it("does not repair indefinitely after schema failures", async () => {
    fixture = new Fixture();
    fixture.completions = ['{"value":"wrong"}', '{"value":"still wrong"}', '{"value":42}'];
    await expect(
      fixture.ctx.llm.extractStructured(z.object({ value: z.number() }), "s", "u"),
    ).rejects.toThrow("invalid structured JSON");
    expect(fixture.providerCalls("cloud.test")).toHaveLength(2);
  });
  it("routes locally without a cloud key and rejects missing cloud credentials", async () => {
    fixture = new Fixture();
    fixture.completions = ['{"value":42}'];
    const client = new LlmClient(fixture.ctx.config.llm, {}, fixture.request);
    expect(
      await client.extractStructured(z.object({ value: z.number() }), "s", "u", "local"),
    ).toEqual({ value: 42 });
    expect(fixture.providerCalls("cloud.test")).toHaveLength(0);
    await expect(
      client.extractStructured(z.object({ value: z.number() }), "s", "u", "cloud"),
    ).rejects.toThrow("LLM_API_KEY");
  });
});
