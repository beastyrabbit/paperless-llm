import { z } from "zod";
import type { Config } from "../config/index.js";
import type { EntityKind } from "../db/store.js";
import { endpoint, equal, fetchJson, HttpError } from "../util.js";

export const versionSchema = z
  .object({
    id: z.number().int(),
    version_label: z.string().nullable().default(null),
    is_root: z.boolean().default(false),
    checksum: z.string().nullable().optional(),
    added: z.string().optional(),
  })
  .passthrough();
export const customValueSchema = z.object({ field: z.number().int(), value: z.unknown() });
export const documentSchema = z
  .object({
    id: z.number().int(),
    title: z.string().default(""),
    content: z.string().default(""),
    added: z.string(),
    modified: z.string().optional(),
    created: z.string().nullable().optional(),
    correspondent: z.number().int().nullable().default(null),
    document_type: z.number().int().nullable().default(null),
    tags: z.array(z.number().int()).default([]),
    custom_fields: z.array(customValueSchema).default([]),
    page_count: z.number().int().positive().nullable().optional(),
    mime_type: z.string().optional(),
    versions: z.array(versionSchema).default([]),
  })
  .passthrough();
export const entitySchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    matching_algorithm: z.number().optional(),
    match: z.string().optional(),
    data_type: z.string().optional(),
    extra_data: z
      .object({
        select_options: z
          .array(
            z.object({
              id: z.union([z.string(), z.number()]),
              label: z.string(),
            }),
          )
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type PaperlessDocument = z.infer<typeof documentSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Entity = z.infer<typeof entitySchema>;
export interface Catalog {
  correspondents: Entity[];
  tags: Entity[];
  document_types: Entity[];
  custom_fields: Entity[];
}
export type DocumentPatch = {
  title?: string;
  correspondent?: number | null;
  document_type?: number | null;
  created?: string;
  custom_fields?: z.infer<typeof customValueSchema>[];
};
const entityPath = (kind: EntityKind) =>
  kind === "document_type"
    ? "document_types"
    : kind === "correspondent"
      ? "correspondents"
      : "tags";
const pageSchema = <T extends z.ZodType>(schema: T) =>
  z
    .object({
      count: z.number().int(),
      next: z.string().nullable(),
      results: z.array(schema),
    })
    .passthrough();

export class PaperlessClient {
  private readonly api: string;
  constructor(
    readonly config: Config["paperless"],
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
    private readonly sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {
    this.api = `${config.url.replace(/\/$/, "").replace(/\/api$/, "")}/api`;
  }
  private async call(
    path: string,
    method = "GET",
    body?: unknown,
    query?: Record<string, string | number>,
  ) {
    const url = new URL(endpoint(this.api, path));
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, String(value));
    return fetchJson(
      this.request,
      url,
      {
        method,
        headers: {
          Authorization: `Token ${this.token}`,
          ...(body instanceof FormData
            ? {}
            : body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      },
      "Paperless",
    );
  }
  private async all<T extends z.ZodType>(
    path: string,
    schema: T,
    query: Record<string, string | number> = {},
  ): Promise<z.infer<T>[]> {
    const result: z.infer<T>[] = [];
    let page = 1;
    for (;;) {
      const response = pageSchema(schema).parse(
        await this.call(path, "GET", undefined, { page_size: 100, ...query, page }),
      );
      result.push(...response.results);
      if (!response.next) return result;
      if (++page > 100_000) throw new Error("Paperless pagination exceeded safety limit");
      // Never follow an untrusted pagination URL with the API token.
    }
  }
  listDocuments(query: Record<string, string | number> = {}) {
    return this.all("/documents/", documentSchema, query);
  }
  async getDocument(id: number, version?: number) {
    return documentSchema.parse(
      await this.call(`/documents/${id}/`, "GET", undefined, version ? { version } : undefined),
    );
  }
  async getVersions(id: number) {
    return (await this.getDocument(id)).versions;
  }
  async downloadVersionPdf(id: number, version: number): Promise<Uint8Array> {
    const url = new URL(endpoint(this.api, `/documents/${id}/download/`));
    url.searchParams.set("version", String(version));
    url.searchParams.set("original", "true");
    const response = await this.request(url, {
      headers: { Authorization: `Token ${this.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status, "Paperless");
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  async patchContent(id: number, version: number, content: string) {
    return documentSchema.parse(
      await this.call(`/documents/${id}/`, "PATCH", { content }, { version }),
    );
  }
  async labelVersion(id: number, version: number, label: string) {
    if (label.length > 64) throw new Error("Version label exceeds 64 characters");
    return versionSchema.parse(
      await this.call(`/documents/${id}/versions/${version}/`, "PATCH", {
        version_label: label,
      }),
    );
  }
  async uploadVersion(id: number, pdf: Uint8Array, label: string) {
    if (label.length > 64) throw new Error("Version label exceeds 64 characters");
    const body = new FormData();
    body.set(
      "document",
      new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
      `document-${id}-ocr.pdf`,
    );
    body.set("version_label", label);
    const value = await this.call(`/documents/${id}/update_version/`, "POST", body);
    return typeof value === "string"
      ? value
      : z.object({ task_id: z.string() }).parse(value).task_id;
  }
  async pollTask(taskId: string, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tasks = z
        .array(
          z
            .object({
              task_id: z.string(),
              status: z.string(),
              related_document: z.union([z.number(), z.string()]).nullable().optional(),
            })
            .passthrough(),
        )
        .parse(await this.call("/tasks/", "GET", undefined, { task_id: taskId }));
      const task = tasks.find((entry) => entry.task_id === taskId);
      if (task?.status === "SUCCESS") return task;
      if (task?.status === "FAILURE" || task?.status === "REVOKED")
        throw new Error("Paperless version task failed");
      await this.sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    }
    throw new Error("Paperless task timeout");
  }
  async modifyTags(docId: number, add: number[], remove: number[]) {
    return this.call("/documents/bulk_edit/", "POST", {
      documents: [docId],
      method: "modify_tags",
      parameters: {
        add_tags: [...new Set(add)],
        remove_tags: [...new Set(remove)].filter((tag) => !add.includes(tag)),
      },
    });
  }
  async patchDocument(docId: number, patch: DocumentPatch) {
    // Tag mutation belongs exclusively to modifyTags.
    if ("tags" in patch || "content" in patch) throw new Error("Unsupported scalar metadata patch");
    return documentSchema.parse(await this.call(`/documents/${docId}/`, "PATCH", patch));
  }
  async patchCustomFields(
    docId: number,
    updates: { field: number; value: unknown; expected: unknown }[],
  ) {
    const doc = await this.getDocument(docId);
    for (const update of updates) {
      if (
        !equal(
          doc.custom_fields.find((field) => field.field === update.field)?.value ?? null,
          update.expected,
        )
      ) {
        throw new Error(`Custom field changed externally: ${update.field}`);
      }
    }
    const fields = new Map(doc.custom_fields.map((entry) => [entry.field, entry.value]));
    for (const update of updates) fields.set(update.field, update.value);
    return this.patchDocument(docId, {
      custom_fields: [...fields].map(([field, value]) => ({ field, value })),
    });
  }
  listEntities(kind: EntityKind) {
    return this.all(`/${entityPath(kind)}/`, entitySchema);
  }
  async catalog(): Promise<Catalog> {
    const [correspondents, tags, document_types, custom_fields] = await Promise.all([
      this.listEntities("correspondent"),
      this.listEntities("tag"),
      this.listEntities("document_type"),
      this.all("/custom_fields/", entitySchema),
    ]);
    return { correspondents, tags, document_types, custom_fields };
  }
  async createEntity(kind: EntityKind, name: string) {
    return entitySchema.parse(
      await this.call(`/${entityPath(kind)}/`, "POST", { name, matching_algorithm: 0 }),
    );
  }
  async deleteEntity(kind: EntityKind, entityId: number) {
    return this.call(`/${entityPath(kind)}/${entityId}/`, "DELETE");
  }
  async superuserStatus(): Promise<"superuser" | "non_superuser" | "unknown"> {
    try {
      const settings = z
        .object({
          user: z.object({ is_superuser: z.boolean().optional() }).passthrough().optional(),
        })
        .passthrough()
        .parse(await this.call("/ui_settings/"));
      if (settings.user?.is_superuser === true) return "superuser";
      if (settings.user?.is_superuser === false) return "non_superuser";
      return "unknown";
    } catch {
      return "unknown";
    }
  }
  async references() {
    const schema = z.record(z.string(), z.unknown());
    const [workflows, saved_views, mail_rules, tags] = await Promise.all([
      this.all("/workflows/", schema),
      this.all("/saved_views/", schema),
      this.all("/mail_rules/", schema),
      this.listEntities("tag"),
    ]);
    return {
      workflows,
      saved_views,
      mail_rules,
      tag_children: tags
        .filter((tag) => tag.parent != null)
        .map((tag) => ({ id: tag.id, parent: tag.parent })),
      inbox_tags: tags.filter((tag) => tag.is_inbox_tag === true).map((tag) => ({ id: tag.id })),
    };
  }
  async findCompetingNativeMatchers() {
    const catalog = await this.catalog();
    return [...catalog.correspondents, ...catalog.tags, ...catalog.document_types].filter(
      (entity) => entity.matching_algorithm !== undefined && entity.matching_algorithm !== 0,
    );
  }
}
