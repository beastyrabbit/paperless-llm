import { vi } from "vitest";
import { type Config, parseConfig } from "../src/config/index.js";
import { type DB, openDb } from "../src/db/db.js";
import {
  type Catalog,
  documentSchema,
  entitySchema,
  PaperlessClient,
  type PaperlessDocument,
} from "../src/paperless/client.js";
import type { Context } from "../src/pipeline/context.js";
import { JevClient, type JevQuestion } from "../src/providers/jev.js";
import { LlmClient } from "../src/providers/llm.js";
import { MistralClient } from "../src/providers/mistral.js";

export const respond = (body: unknown, status = 200) =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
export function testConfig(edit?: (config: Config) => void) {
  const { config } = parseConfig({
    paperless: { url: "http://paperless.test" },
    ocr: { enabled: true, notBefore: "2026-11-01", maxPagesPerDay: 20 },
    llm: {
      cloud: { baseUrl: "http://cloud.test/v1", model: "fixture" },
      local: { baseUrl: "http://local.test/v1", model: "fixture-local" },
    },
    jev: { apiBaseUrl: "http://jev.test/v1/systemone" },
  });
  edit?.(config);
  return parseConfig(config);
}
export function document(id = 1, values: Partial<PaperlessDocument> = {}): PaperlessDocument {
  return documentSchema.parse({
    id,
    title: "",
    content:
      "Acme GmbH\nInvoice 12345\nDate 21.11.2026\nTotal 1.234,56 EUR\nVAT DE123456789\nContact billing@acme.test",
    added: "2026-11-21T10:00:00Z",
    modified: "2026-11-21T10:00:00Z",
    created: "2026-11-21",
    page_count: 2,
    versions: [{ id, version_label: null, is_root: true }],
    tags: [10, 99],
    ...values,
  });
}
export class Fixture {
  readonly db: DB = openDb(":memory:");
  readonly docs = new Map<number, PaperlessDocument>([[1, document()]]);
  readonly contents = new Map<number, string>();
  readonly catalog: Catalog = {
    correspondents: [entitySchema.parse({ id: 1, name: "Acme GmbH", matching_algorithm: 0 })],
    document_types: [entitySchema.parse({ id: 2, name: "Invoice", matching_algorithm: 0 })],
    tags: [
      { id: 10, name: "ai:requested", matching_algorithm: 0 },
      { id: 11, name: "ai:review", matching_algorithm: 0 },
      { id: 12, name: "ai:failed", matching_algorithm: 0 },
      { id: 20, name: "finance", matching_algorithm: 0 },
      { id: 99, name: "human-tag", matching_algorithm: 0 },
    ],
    custom_fields: [
      { id: 101, name: "total", data_type: "monetary" },
      { id: 102, name: "invoice_date", data_type: "date" },
      { id: 103, name: "invoice_number", data_type: "string" },
      { id: 104, name: "paid", data_type: "boolean" },
      {
        id: 105,
        name: "category",
        data_type: "select",
        extra_data: { select_options: [{ id: "option-a", label: "A" }] },
      },
    ],
  };
  readonly calls: { url: URL; method: string; body: unknown }[] = [];
  references: Record<string, unknown[]> = { workflows: [], saved_views: [], mail_rules: [] };
  isSuperuser = true;
  labelRootStatus?: number;
  onOcr?: () => void;
  fail?: (url: URL, init: RequestInit) => Response | undefined;
  ocrError?: Error;
  jev: (state: string, question: JevQuestion) => Record<string, unknown> = (_state, question) =>
    question.type === "noul"
      ? { type: "noul", noul: 0.999 }
      : question.type === "score"
        ? {
            type: "score",
            score: 1,
            confidence: 0.99,
            legend: { 0: "low", 1: "high" },
            probabilities: { 0: 0.01, 1: 0.99 },
          }
        : {
            type: "choice",
            choice: Object.keys(question.criteria)[0],
            confidence: 0.99,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((key, index) => [key, index ? 0 : 1]),
            ),
          };
  completions: string[] = [JSON.stringify({ fields: [] })];
  pageSize = 100;
  readonly request: typeof fetch = vi.fn(async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? "GET";
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    this.calls.push({ url, method, body });
    const failure = this.fail?.(url, init);
    if (failure) return failure;
    if (url.host === "api.mistral.ai") {
      this.onOcr?.();
      if (this.ocrError) throw this.ocrError;
      return respond({
        pages: [
          { index: 0, markdown: "Acme Invoice\n21.11.2026 1.234,56 EUR" },
          { index: 1, markdown: "Terms" },
        ],
        usage_info: { pages_processed: 2 },
      });
    }
    if (url.host === "jev.test") {
      const request = body as { state: string; questions: { result: JevQuestion } };
      return respond({
        model: "jev-latest",
        answers: { result: this.jev(request.state, request.questions.result) },
        usage: { input_tokens: 100, output_tokens: 10, cost: 0.01 },
      });
    }
    if (url.host === "cloud.test" || url.host === "local.test") {
      return respond({
        choices: [{ message: { content: this.completions.shift() ?? "{}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      });
    }
    if (url.host !== "paperless.test") throw new Error(`Unexpected mocked host ${url.host}`);
    const path = url.pathname.replace(/^\/api/, "");
    const list = (rows: unknown[]) => {
      const page = Number(url.searchParams.get("page") ?? 1);
      const start = (page - 1) * this.pageSize;
      return respond({
        count: rows.length,
        next: start + this.pageSize < rows.length ? "http://untrusted.test/page" : null,
        results: rows.slice(start, start + this.pageSize),
      });
    };
    if (path === "/ui_settings/")
      return respond({ user: { id: 1, username: "admin", is_superuser: this.isSuperuser } });
    if (path === "/tasks/") return respond([{ task_id: "task-1", status: "SUCCESS" }]);
    if (path === "/documents/bulk_edit/") {
      const data = body as {
        documents: number[];
        method: string;
        parameters: { add_tags: number[]; remove_tags: number[] };
      };
      if (data.method !== "modify_tags") throw new Error("Expected delta tags");
      for (const docId of data.documents) {
        const doc = this.docs.get(docId);
        if (!doc) throw new Error("Missing fixture doc");
        doc.tags = [
          ...new Set([
            ...doc.tags.filter((tag) => !data.parameters.remove_tags.includes(tag)),
            ...data.parameters.add_tags,
          ]),
        ];
      }
      return respond("OK");
    }
    if (path === "/documents/") {
      let rows = [...this.docs.values()];
      const cutoff = url.searchParams.get("added__gte"),
        tags = url.searchParams.get("tags__id__all");
      if (cutoff) rows = rows.filter((doc) => doc.added.slice(0, 10) >= cutoff);
      if (tags) rows = rows.filter((doc) => doc.tags.includes(Number(tags)));
      for (const kind of ["correspondent", "document_type"] as const) {
        const entity = url.searchParams.get(`${kind}__id`);
        if (entity) rows = rows.filter((doc) => doc[kind] === Number(entity));
      }
      return list(rows);
    }
    const match = /^\/documents\/(\d+)\/(.*)$/.exec(path);
    if (match) {
      const docId = Number(match[1]),
        action = match[2];
      const doc = this.docs.get(docId);
      if (!doc) return respond({}, 404);
      if (action === "download/") return new Response("%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n");
      if (action === "update_version/") {
        const form = init.body as FormData;
        const versionId = docId + 10_000;
        doc.versions.unshift({
          id: versionId,
          is_root: false,
          version_label: String(form.get("version_label")),
        });
        this.contents.set(versionId, "");
        doc.content = "";
        return respond("task-1");
      }
      const version = /^versions\/(\d+)\/$/.exec(action ?? "");
      if (version) {
        const entry = doc.versions.find((value) => value.id === Number(version[1]));
        if (this.labelRootStatus && entry?.is_root) return respond({}, this.labelRootStatus);
        if (!entry) return respond({}, 404);
        entry.version_label = (body as { version_label: string }).version_label;
        return respond(entry);
      }
      if (!action) {
        const versionId = Number(url.searchParams.get("version") ?? doc.versions[0]?.id ?? docId);
        if (method === "PATCH") {
          if (body && typeof body === "object" && "content" in body) {
            this.contents.set(versionId, String(body.content));
            if (versionId === doc.versions[0]?.id) doc.content = String(body.content);
          } else Object.assign(doc, body);
        }
        return respond({ ...doc, content: this.contents.get(versionId) ?? doc.content });
      }
    }
    const entity = /^\/(correspondents|tags|document_types|custom_fields)\/(?:(\d+)\/)?$/.exec(
      path,
    );
    if (entity) {
      const key = entity[1] as keyof Catalog,
        rows = this.catalog[key];
      if (method === "POST") {
        const added = entitySchema.parse({ id: 1000 + rows.length, ...(body as object) });
        rows.push(added);
        return respond(added);
      }
      if (method === "DELETE") {
        const index = rows.findIndex((entry) => entry.id === Number(entity[2]));
        if (index >= 0) rows.splice(index, 1);
        return respond(null, 204);
      }
      return list(rows);
    }
    for (const name of ["workflows", "saved_views", "mail_rules"])
      if (path === `/${name}/`) return list(this.references[name] ?? []);
    throw new Error(`Unexpected mock endpoint ${method} ${path}`);
  });
  readonly ctx: Context;
  constructor(edit?: (config: Config) => void) {
    const loaded = testConfig(edit);
    this.ctx = {
      ...loaded,
      db: this.db,
      paperless: new PaperlessClient(loaded.config.paperless, "fixture-token", this.request),
      mistral: new MistralClient(loaded.config.ocr, "fixture-mistral", this.request),
      jev: new JevClient(loaded.config.jev, "fixture-jev", this.request),
      llm: new LlmClient(loaded.config.llm, { llmApiKey: "fixture-llm" }, this.request),
    };
  }
  providerCalls(host: string) {
    return this.calls.filter((call) => call.url.host === host);
  }
  close() {
    this.db.close();
  }
}
