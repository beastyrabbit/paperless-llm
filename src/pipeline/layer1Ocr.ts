import { enqueue, getJob, getSource, type Job, saveSource, updateJob } from "../db/store.js";
import type { PaperlessDocument, Version } from "../paperless/client.js";
import { assertPageBudget } from "../providers/mistral.js";
import { HttpError, json, now, parseJson, sha256 } from "../util.js";
import type { Context } from "./context.js";

export const marker = (state: "done" | "pending", hash: string) =>
  `mistral-ocr:v1:${state}:${hash.slice(0, 12)}`;
const markerPattern = /^mistral-ocr:v1:(done|pending):([a-f0-9]{12})$/;
function skipOcr(ctx: Context, doc: PaperlessDocument, job?: Job) {
  saveSource(ctx.db, {
    doc_id: doc.id,
    ocr_status: "skipped",
    source_version_id: selectedVersion(doc).id,
  });
  if (job)
    updateJob(ctx.db, job.id, {
      state: "done",
      lease_owner: null,
      lease_expires_at: null,
      last_error: null,
    });
  return "skipped";
}
function uploadIntent(ctx: Context, jobId: string, pending: boolean) {
  const usage = parseJson<Record<string, unknown>>(getJob(ctx.db, jobId)?.usage_json ?? null, {});
  if (pending) usage.uploadIntent = true;
  else delete usage.uploadIntent;
  updateJob(ctx.db, jobId, { usage_json: json(usage) });
}
export function derivativePdf(pdf: Uint8Array, hash: string) {
  if (!Buffer.from(pdf.subarray(0, 5)).equals(Buffer.from("%PDF-")))
    throw new Error("OCR input must be a PDF");
  // A PDF comment following %%EOF changes the bytes without changing page streams or offsets.
  return Buffer.concat([pdf, Buffer.from(`\n% Paperless Local LLM OCR source-sha256=${hash}\n`)]);
}
function selectedVersion(doc: PaperlessDocument): Version {
  return doc.versions[0] ?? { id: doc.id, is_root: true, version_label: null };
}
function markedVersion(doc: PaperlessDocument) {
  return (
    doc.versions.find((version) => /^mistral-ocr:v1:done:/.test(version.version_label ?? "")) ??
    doc.versions.find((version) => markerPattern.test(version.version_label ?? ""))
  );
}
function uncertainMarkerJob(ctx: Context, doc: PaperlessDocument, version: Version) {
  const job = enqueue(
    ctx.db,
    doc.id,
    "ocr",
    `reconcile:${doc.id}:${version.id}:${ctx.configHash}`,
    ctx.configHash,
  );
  updateJob(ctx.db, job.id, {
    state: "uncertain",
    last_error: "Pending OCR marker without saved result; explicit retry may incur another charge",
  });
}
export async function reconcile(ctx: Context) {
  let rebuilt = 0;
  for (const doc of await ctx.paperless.listDocuments()) {
    const version = markedVersion(doc) ?? selectedVersion(doc);
    const found = markerPattern.exec(version.version_label ?? "");
    if (!found) continue;
    const existing = getSource(ctx.db, doc.id);
    const content = (await ctx.paperless.getDocument(doc.id, version.id)).content;
    if (found[1] === "pending") {
      // A pending label alone cannot prove a completed content write after DB loss.
      saveSource(ctx.db, {
        doc_id: doc.id,
        ocr_status: existing?.ocr_text ? "pending_write" : "uncertain",
        source_sha256: existing?.source_sha256 ?? found[2],
        output_version_id: version.id,
        source_version_id: existing?.source_version_id ?? version.id,
      });
      if (!existing?.ocr_text) uncertainMarkerJob(ctx, doc, version);
    } else {
      saveSource(ctx.db, {
        doc_id: doc.id,
        ocr_status: "done",
        source_sha256: existing?.source_sha256 ?? found[2],
        source_version_id: existing?.source_version_id ?? version.id,
        output_version_id: version.id,
        ocr_text: content,
        content_hash: sha256(content),
      });
    }
    rebuilt++;
  }
  ctx.db
    .prepare(
      "INSERT INTO runtime_state(key,value) VALUES('last_reconcile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(now());
  return rebuilt;
}
export async function discoverOcr(ctx: Context) {
  if (!ctx.config.ocr.enabled) return [];
  const docs = await ctx.paperless.listDocuments({ added__gte: ctx.config.ocr.notBefore });
  const queued: Job[] = [];
  for (const doc of docs) {
    if (doc.added.slice(0, 10) < ctx.config.ocr.notBefore) continue;
    if (doc.mime_type && doc.mime_type !== "application/pdf") {
      skipOcr(ctx, doc);
      ctx.db
        .prepare(
          "UPDATE jobs SET state='done',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL WHERE doc_id=? AND stage='ocr' AND state IN ('queued','retry_wait') AND config_hash=?",
        )
        .run(doc.id, ctx.configHash);
      continue;
    }
    const version = selectedVersion(doc);
    const source = getSource(ctx.db, doc.id);
    const marked = markedVersion(doc);
    if (marked) {
      if (!source || (marked.version_label?.includes(":done:") && source.ocr_status !== "done"))
        await runOcr(ctx, doc.id);
      continue;
    }
    if (source?.ocr_status === "uncertain" && !ctx.config.ocr.allowAutoRetryUncertain) continue;
    if (source?.ocr_status === "done" && source.output_version_id === version.id) continue;
    if (source?.ocr_status === "skipped" && source.source_version_id === version.id) continue;
    const job = enqueue(
      ctx.db,
      doc.id,
      "ocr",
      `ocr:${doc.id}:${version.id}:${ctx.configHash}`,
      ctx.configHash,
    );
    if (job.state === "uncertain" && ctx.config.ocr.allowAutoRetryUncertain) {
      updateJob(ctx.db, job.id, { state: "queued", lease_owner: null, lease_expires_at: null });
      saveSource(ctx.db, { doc_id: doc.id, ocr_status: "discovered" });
    }
    queued.push(job);
  }
  return queued;
}
export async function runOcr(ctx: Context, docId: number, suppliedJob?: Job) {
  const doc = await ctx.paperless.getDocument(docId);
  if (doc.mime_type && doc.mime_type !== "application/pdf") return skipOcr(ctx, doc, suppliedJob);
  if (!ctx.config.ocr.enabled || doc.added.slice(0, 10) < ctx.config.ocr.notBefore) {
    if (!getSource(ctx.db, docId)) saveSource(ctx.db, { doc_id: docId, ocr_status: "skipped" });
    if (suppliedJob)
      updateJob(ctx.db, suppliedJob.id, {
        state: "done",
        lease_owner: null,
        lease_expires_at: null,
      });
    return "skipped";
  }
  const head = markedVersion(doc) ?? selectedVersion(doc);
  const done = markerPattern.exec(head.version_label ?? "");
  let source = getSource(ctx.db, docId);
  if (done?.[1] === "done") {
    const content = (await ctx.paperless.getDocument(docId, head.id)).content;
    saveSource(ctx.db, {
      doc_id: docId,
      source_sha256: source?.source_sha256 ?? done[2],
      output_version_id: head.id,
      ocr_status: "done",
      ocr_text: content,
      content_hash: sha256(content),
    });
    if (suppliedJob) {
      uploadIntent(ctx, suppliedJob.id, false);
      updateJob(ctx.db, suppliedJob.id, {
        state: "done",
        lease_owner: null,
        lease_expires_at: null,
      });
    }
    return "done";
  }
  if (
    done?.[1] === "pending" &&
    !source?.ocr_text &&
    !(source?.ocr_status === "discovered" && suppliedJob)
  ) {
    saveSource(ctx.db, { doc_id: docId, ocr_status: "uncertain", output_version_id: head.id });
    if (suppliedJob) updateJob(ctx.db, suppliedJob.id, { state: "uncertain" });
    else uncertainMarkerJob(ctx, doc, head);
    return "uncertain";
  }
  const job =
    suppliedJob ??
    enqueue(ctx.db, docId, "ocr", `ocr:${docId}:${head.id}:${ctx.configHash}`, ctx.configHash);
  const fresh = getJob(ctx.db, job.id);
  if (
    (source?.ocr_status === "uncertain" || fresh?.state === "uncertain") &&
    !ctx.config.ocr.allowAutoRetryUncertain
  )
    return "uncertain";
  if (source?.ocr_status === "done" && source.output_version_id === head.id) {
    updateJob(ctx.db, job.id, { state: "done" });
    return "done";
  }
  if (!source?.ocr_text || !["result_saved", "pending_write"].includes(source.ocr_status)) {
    const pdf = await ctx.paperless.downloadVersionPdf(docId, head.id);
    if (Buffer.from(pdf.subarray(0, 5)).toString() !== "%PDF-") return skipOcr(ctx, doc, job);
    const hash = sha256(pdf);
    ctx.db.transaction(() => {
      assertPageBudget(ctx.db, ctx.config.ocr.maxPagesPerDay, doc.page_count ?? 0);
      const previousUsage = parseJson<
        Record<string, unknown> & { reservedPages?: number; budgetDate?: string }
      >(fresh?.usage_json ?? null, {});
      // Count every explicitly retried ambiguous attempt, even if the provider charged both.
      const budgetDate = now().slice(0, 10);
      updateJob(ctx.db, job.id, {
        state: "running",
        attempts: Math.max(fresh?.attempts ?? 0, 1),
        usage_json: json({
          ...previousUsage,
          reservedPages:
            (previousUsage.budgetDate === budgetDate ? (previousUsage.reservedPages ?? 0) : 0) +
            (doc.page_count ?? 0),
          budgetDate,
        }),
      });
      saveSource(ctx.db, {
        doc_id: docId,
        source_version_id: head.id,
        source_sha256: hash,
        ocr_status: "running",
        previous_content: doc.content,
        ocr_text: null,
      });
    })();
    try {
      const result = await ctx.mistral.ocr(pdf, doc.page_count ?? 0);
      ctx.db.transaction(() => {
        saveSource(ctx.db, {
          doc_id: docId,
          ocr_status: "result_saved",
          ocr_text: result.text,
          ocr_pages: result.pages,
          content_hash: sha256(result.text),
        });
        updateJob(ctx.db, job.id, { response_json: json(result.response) });
      })();
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        saveSource(ctx.db, { doc_id: docId, ocr_status: "discovered" });
        // Rate limiting rejects the request before processing; release its reservation.
        updateJob(ctx.db, job.id, { usage_json: fresh?.usage_json ?? null });
        throw error;
      }
      const rejected =
        error instanceof HttpError && error.status >= 400 && error.status < 500 && !error.transient;
      saveSource(ctx.db, { doc_id: docId, ocr_status: rejected ? "failed" : "uncertain" });
      updateJob(ctx.db, job.id, {
        state: rejected ? "failed" : "uncertain",
        last_error: rejected
          ? "OCR request rejected"
          : "OCR outcome uncertain; explicit retry required",
      });
      throw error;
    }
    source = getSource(ctx.db, docId);
  }
  if (!source?.ocr_text || !source.source_sha256) throw new Error("Saved OCR result is missing");
  const pending = marker("pending", source.source_sha256);
  const final = marker("done", source.source_sha256);
  let output = source.output_version_id;
  saveSource(ctx.db, { doc_id: docId, ocr_status: "pending_write" });
  if (!output && ctx.config.ocr.versionMode === "in_place") {
    try {
      // Label before content so recovery can identify an interrupted write.
      await ctx.paperless.labelVersion(docId, source.source_version_id ?? head.id, pending);
      output = source.source_version_id ?? head.id;
    } catch (error) {
      if (!(error instanceof HttpError) || ![400, 404, 405].includes(error.status)) throw error;
    }
  }
  if (!output) {
    const versions = await ctx.paperless.getVersions(docId);
    output =
      versions.find(
        (version) => version.version_label === pending || version.version_label === final,
      )?.id ?? null;
    if (!output) {
      let task = getJob(ctx.db, job.id)?.provider_task_id;
      if (!task) {
        const bytes = await ctx.paperless.downloadVersionPdf(
          docId,
          source.source_version_id ?? head.id,
        );
        // Persist an upload intent. If the response is lost, do not create duplicate derivatives.
        if (
          parseJson<{ uploadIntent?: boolean }>(getJob(ctx.db, job.id)?.usage_json ?? null, {})
            .uploadIntent
        )
          throw new Error("Version upload outcome unknown; reconcile Paperless before retry");
        uploadIntent(ctx, job.id, true);
        task = await ctx.paperless.uploadVersion(
          docId,
          derivativePdf(bytes, source.source_sha256),
          pending,
        );
        updateJob(ctx.db, job.id, { provider_task_id: task, last_error: null });
        uploadIntent(ctx, job.id, false);
      }
      await ctx.paperless.pollTask(task);
      output =
        (await ctx.paperless.getVersions(docId)).find(
          (version) => version.version_label === pending || version.version_label === final,
        )?.id ?? null;
    }
  }
  if (!output) throw new Error("OCR output version not found");
  uploadIntent(ctx, job.id, false);
  saveSource(ctx.db, { doc_id: docId, output_version_id: output, ocr_status: "pending_write" });
  await ctx.paperless.patchContent(docId, output, source.ocr_text);
  const read = await ctx.paperless.getDocument(docId, output);
  if (sha256(read.content) !== source.content_hash)
    throw new Error("OCR content verification failed");
  await ctx.paperless.labelVersion(docId, output, final);
  if (
    !(await ctx.paperless.getVersions(docId)).some(
      (version) => version.id === output && version.version_label === final,
    )
  )
    throw new Error("OCR marker verification failed");
  saveSource(ctx.db, { doc_id: docId, ocr_status: "done" });
  updateJob(ctx.db, job.id, {
    state: "done",
    lease_owner: null,
    lease_expires_at: null,
    last_error: null,
  });
  return "done";
}
