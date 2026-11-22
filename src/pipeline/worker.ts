import { enqueue, getJob, getSource, type Job, updateJob } from "../db/store.js";
import { BudgetExhaustedError } from "../providers/mistral.js";
import { HttpError, id, json, NetworkError, now, parseJson, sha256 } from "../util.js";
import { applyCandidates, ocrReady, serviceTags } from "./apply.js";
import type { Candidate, Context } from "./context.js";
import { gate } from "./gate.js";
import { discoverOcr, reconcile, runOcr } from "./layer1Ocr.js";
import { type Classification, classify, templateTitle } from "./layer2Classify.js";
import { type ExtractedField, extract } from "./layer3Extract.js";

interface MetadataProgress {
  contentHash?: string;
  classification?: Classification;
  extracted?: ExtractedField[];
  checked?: Candidate[];
  candidates?: Candidate[];
}

export function recoverLeases(ctx: Context) {
  ctx.db.transaction(() => {
    const expired = ctx.db
      .prepare(
        "SELECT * FROM jobs WHERE state='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?)",
      )
      .all(now()) as Job[];
    for (const job of expired) {
      const source = getSource(ctx.db, job.doc_id);
      const uncertain = job.stage === "ocr" && source?.ocr_status === "running";
      updateJob(ctx.db, job.id, {
        state: uncertain ? "uncertain" : job.stage === "consolidation" ? "failed" : "retry_wait",
        lease_owner: null,
        lease_expires_at: null,
        last_error: uncertain
          ? "Worker stopped during paid OCR; explicit retry required"
          : job.last_error,
      });
      if (uncertain)
        ctx.db
          .prepare("UPDATE sources SET ocr_status='uncertain',updated_at=? WHERE doc_id=?")
          .run(now(), job.doc_id);
    }
  })();
}
export function claim(ctx: Context, owner: string): Job | undefined {
  return ctx.db
    .transaction(() => {
      const job = ctx.db
        .prepare(
          "SELECT * FROM jobs WHERE state IN ('queued','retry_wait') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY CASE stage WHEN 'ocr' THEN 0 ELSE 1 END,created_at LIMIT 1",
        )
        .get(now()) as Job | undefined;
      if (!job) return;
      const expiry = new Date(Date.now() + ctx.config.polling.leaseDurationMs).toISOString();
      updateJob(ctx.db, job.id, {
        state: "running",
        attempts: job.attempts + 1,
        lease_owner: owner,
        lease_expires_at: expiry,
      });
      return getJob(ctx.db, job.id);
    })
    .immediate();
}
export function retryJob(ctx: Context, jobId: string, confirmUncertain = false) {
  const job = getJob(ctx.db, jobId);
  if (!job || !["failed", "uncertain"].includes(job.state)) throw new Error("Job is not retryable");
  if (job.stage === "consolidation")
    throw new Error("Start a fresh catalog operation after inspecting its batch");
  if (job.state === "uncertain" && !confirmUncertain)
    throw new Error("Confirm retry: the OCR request may be billed twice");
  ctx.db.transaction(() => {
    const usage = { ...parseJson<Record<string, unknown>>(job.usage_json, {}) };
    const hadIntent = job.stage === "ocr" && "uploadIntent" in usage;
    if (hadIntent) delete usage.uploadIntent;
    const nextUsage = hadIntent ? (Object.keys(usage).length ? json(usage) : null) : job.usage_json;
    updateJob(ctx.db, job.id, {
      state: "queued",
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: null,
      usage_json: nextUsage,
    });
    if (job.stage === "ocr") {
      ctx.db
        .prepare(
          "UPDATE sources SET ocr_status=CASE WHEN ocr_text IS NOT NULL THEN 'pending_write' ELSE 'discovered' END,updated_at=? WHERE doc_id=?",
        )
        .run(now(), job.doc_id);
    }
  })();
}
export async function metadata(ctx: Context, job: Job) {
  const account = (provider: string) => (usage: unknown) => {
    const history = parseJson<unknown[]>(getJob(ctx.db, job.id)?.usage_json ?? null, []);
    updateJob(ctx.db, job.id, { usage_json: json([...history, { provider, usage }]) });
  };
  ctx = {
    ...ctx,
    jev: ctx.jev.withAccounting(account("jev")),
    llm: ctx.llm.withAccounting(account("llm")),
  };
  if (!ocrReady(ctx, job.doc_id)) throw new Error("OCR must finish before metadata");
  const saved = parseJson<MetadataProgress>(getJob(ctx.db, job.id)?.response_json ?? null, {});
  const save = () => updateJob(ctx.db, job.id, { response_json: json(saved) });
  const doc = await ctx.paperless.getDocument(job.doc_id);
  const contentHash = sha256(doc.content);
  if (saved.contentHash && saved.contentHash !== contentHash)
    throw new Error("OCR content changed; request a fresh metadata job");
  let fields = saved.candidates;
  if (!fields) {
    saved.contentHash = contentHash;
    const catalog = await ctx.paperless.catalog();
    const layer2 = saved.classification ?? (await classify(ctx, doc, catalog));
    saved.classification = layer2;
    save();
    fields = layer2.fields;
    if (layer2.needsL3) {
      const extracted = saved.extracted ?? (await extract(ctx, doc, layer2, catalog));
      saved.extracted = extracted;
      save();
      const definitions = layer2.documentTypeName
        ? (ctx.config.documentTypes[layer2.documentTypeName]?.openFields ?? [])
        : [];
      const checked = saved.checked ?? [];
      for (const field of extracted.slice(checked.length)) {
        checked.push(...(await gate(ctx, doc.content, [field], fields, catalog, definitions)));
        saved.checked = checked;
        save();
      }
      fields = fields
        .filter((field) => !checked.some((entry) => entry.field === field.field))
        .concat(checked);
      for (const field of layer2.openFields.filter((field) => field.required)) {
        if (!fields.some((entry) => entry.field === `custom:${field.name}`))
          fields.push({
            field: `custom:${field.name}`,
            value: null,
            passed: false,
            confidence: 0,
            checks: { reason: "Required open field missing", typeValid: false },
          });
      }
      const resolvedType = fields.find((field) => field.field === "document_type" && field.passed);
      const typeName = catalog.document_types.find(
        (entity) => entity.id === resolvedType?.value,
      )?.name;
      // A type resolved by L3 may introduce required fields. Stage them, never make a second extraction.
      for (const definition of (typeName ? ctx.config.documentTypes[typeName]?.openFields : []) ??
        []) {
        if (
          definition.required &&
          !fields.some((field) => field.field === `custom:${definition.name}`)
        )
          fields.push({
            field: `custom:${definition.name}`,
            value: null,
            passed: false,
            confidence: 0,
            checks: {
              reason: "Required field awaits review",
              typeValid: false,
              customFieldId: catalog.custom_fields.find((entity) => entity.name === definition.name)
                ?.id,
            },
          });
      }
      const title = templateTitle(ctx, fields, doc, typeName);
      fields = fields.filter((field) => field.field !== "title");
      if (title) fields.push(title);
    }
    saved.candidates = fields;
    save();
  }
  await applyCandidates(ctx, job.doc_id, fields);
  updateJob(ctx.db, job.id, {
    state: "done",
    lease_owner: null,
    lease_expires_at: null,
    last_error: null,
  });
}
export async function reconcileOcrTagRestorations(ctx: Context) {
  const pending = ctx.db
    .prepare(
      "SELECT * FROM jobs WHERE stage='ocr' AND state='done' AND (json_extract(usage_json,'$.restoreRequestedTag')=1 OR json_extract(usage_json,'$.clearedFailedTag')=1)",
    )
    .all() as Job[];
  for (const job of pending) {
    const usage = { ...parseJson<Record<string, unknown>>(job.usage_json ?? null, {}) };
    const restoreRequested = usage.restoreRequestedTag === true;
    await serviceTags(ctx, job.doc_id, restoreRequested ? "requested" : "clean");
    delete usage.restoreRequestedTag;
    delete usage.clearedFailedTag;
    updateJob(ctx.db, job.id, {
      usage_json: Object.keys(usage).length ? json(usage) : null,
    });
  }
}
export class Worker {
  readonly owner = id();
  private stopped = false;
  private running?: Promise<void>;
  private wake?: () => void;
  constructor(readonly ctx: Context) {}
  async initialize() {
    if (!this.ctx.db.prepare("SELECT 1 FROM sources LIMIT 1").get()) await reconcile(this.ctx);
    recoverLeases(this.ctx);
    const competing = await this.ctx.paperless.findCompetingNativeMatchers();
    if (competing.length)
      console.warn(`Competing Paperless native matchers enabled on ${competing.length} entities`);
  }
  async discover() {
    await discoverOcr(this.ctx);
    await reconcileOcrTagRestorations(this.ctx);
    const tags = await this.ctx.paperless.listEntities("tag");
    const request = tags.find((tag) => tag.name === this.ctx.config.tags.requested);
    if (!request) return;
    for (const doc of await this.ctx.paperless.listDocuments({ tags__id__all: request.id })) {
      if (!ocrReady(this.ctx, doc.id) && doc.added.slice(0, 10) < this.ctx.config.ocr.notBefore)
        await runOcr(this.ctx, doc.id);
      if (ocrReady(this.ctx, doc.id))
        enqueue(
          this.ctx.db,
          doc.id,
          "metadata",
          "metadata:" +
            doc.id +
            ":" +
            sha256(doc.content) +
            ":" +
            this.ctx.configHash +
            ":" +
            (doc.modified ?? doc.added),
          this.ctx.configHash,
        );
    }
  }
  async tick() {
    recoverLeases(this.ctx);
    // Supersede future retries as well as runnable jobs, without changing request tags.
    this.ctx.db
      .prepare(
        "UPDATE jobs SET state='failed',last_error='Superseded by newer configuration',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE config_hash!=? AND state IN ('queued','retry_wait')",
      )
      .run(now(), this.ctx.configHash);
    await this.discover();
    for (let count = 0; count < this.ctx.config.polling.batchSize && !this.stopped; count++) {
      const job = claim(this.ctx, this.owner);
      if (!job) break;
      // Extend the lease while an awaited provider request or Paperless task is outstanding.
      const heartbeat = setInterval(
        () =>
          this.ctx.db
            .prepare(
              "UPDATE jobs SET lease_expires_at=? WHERE id=? AND state='running' AND lease_owner=?",
            )
            .run(
              new Date(Date.now() + this.ctx.config.polling.leaseDurationMs).toISOString(),
              job.id,
              this.owner,
            ),
        Math.max(250, this.ctx.config.polling.leaseDurationMs / 3),
      );
      try {
        if (job.config_hash !== this.ctx.configHash) {
          updateJob(this.ctx.db, job.id, {
            state: "failed",
            last_error: "Superseded by newer configuration",
            lease_owner: null,
            lease_expires_at: null,
          });
          continue;
        }
        if (job.stage === "ocr") {
          await runOcr(this.ctx, job.doc_id, job);
          await reconcileOcrTagRestorations(this.ctx);
        } else if (job.stage === "metadata") await metadata(this.ctx, job);
        else throw new Error("Unsupported worker stage");
      } catch (error) {
        if (error instanceof BudgetExhaustedError) {
          const midnight = new Date();
          midnight.setUTCHours(24, 0, 0, 0);
          updateJob(this.ctx.db, job.id, {
            state: "retry_wait",
            attempts: Math.max(0, job.attempts - 1),
            next_attempt_at: midnight.toISOString(),
            lease_owner: null,
            lease_expires_at: null,
            last_error: error.message,
          });
          continue;
        }
        const failJobTags = async () => {
          if (job.stage === "ocr") {
            const [doc, tags] = await Promise.all([
              this.ctx.paperless.getDocument(job.doc_id),
              this.ctx.paperless.listEntities("tag"),
            ]);
            const requestedId = tags.find((t) => t.name === this.ctx.config.tags.requested)?.id;
            const current = getJob(this.ctx.db, job.id);
            const usage = {
              ...parseJson<Record<string, unknown>>(current?.usage_json ?? null, {}),
            };
            if (requestedId !== undefined && doc.tags.includes(requestedId)) {
              usage.restoreRequestedTag = true;
            } else {
              usage.clearedFailedTag = true;
            }
            updateJob(this.ctx.db, job.id, { usage_json: json(usage) });
          }
          await serviceTags(this.ctx, job.doc_id, "failed");
        };
        const latest = getJob(this.ctx.db, job.id);
        if (latest?.state === "uncertain" || latest?.state === "failed") {
          if (latest.state === "failed") await failJobTags();
          continue;
        }
        const source = getSource(this.ctx.db, job.doc_id);
        const savedOcr =
          job.stage === "ocr" &&
          ["result_saved", "pending_write"].includes(source?.ocr_status ?? "");
        const retry =
          job.attempts < this.ctx.config.polling.maxAttempts &&
          (savedOcr ||
            error instanceof NetworkError ||
            (error instanceof HttpError && error.transient));
        updateJob(this.ctx.db, job.id, {
          state: retry ? "retry_wait" : "failed",
          lease_owner: null,
          lease_expires_at: null,
          next_attempt_at: new Date(
            Date.now() + Math.min(3_600_000, 1000 * 2 ** job.attempts),
          ).toISOString(),
          last_error:
            error instanceof HttpError
              ? error.message
              : "Processing failed; inspect state before retry",
        });
        if (!retry) await failJobTags();
      } finally {
        clearInterval(heartbeat);
      }
    }
  }
  start() {
    this.running = (async () => {
      await this.initialize();
      while (!this.stopped) {
        try {
          await this.tick();
        } catch {
          console.error("Polling failed; will retry");
        }
        if (!this.stopped)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.ctx.config.polling.intervalMs);
            this.wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
      }
    })();
    return this.running;
  }
  async stop() {
    this.stopped = true;
    this.wake?.();
    await this.running;
  }
}
