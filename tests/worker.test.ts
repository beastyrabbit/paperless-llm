import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueue, getJob, getSource, updateJob } from "../src/db/store.js";
import { retryJob, Worker } from "../src/pipeline/worker.js";
import { NetworkError } from "../src/util.js";
import { document, Fixture, respond } from "./helpers.js";

let fixture: Fixture;
afterEach(() => {
  fixture?.close();
  vi.useRealTimers();
});

function setup() {
  fixture = new Fixture((config) => {
    config.ocr.enabled = false;
    config.documentTypes.Invoice = {
      selectFields: [],
      openFields: [
        { name: "total", kind: "monetary", required: true, semanticCheck: true },
        { name: "invoice_date", kind: "date", required: true, semanticCheck: true },
      ],
    };
  });
  const job = enqueue(fixture.db, 1, "metadata", "bounded-metadata", fixture.ctx.configHash);
  const worker = new Worker(fixture.ctx);
  vi.spyOn(worker, "discover").mockResolvedValue();
  return { worker, job };
}

describe("durable bounded metadata processing", () => {
  it("stages a null L3 tag for review without failing the worker", async () => {
    fixture = new Fixture((config) => {
      config.ocr.enabled = false;
      config.tags.curated = { finance: "Financial documents" };
    });
    const original = fixture.jev;
    fixture.jev = (state, question) =>
      question.type === "noul" ? { type: "noul", noul: 0.5 } : original(state, question);
    fixture.completions = [
      JSON.stringify({
        fields: [{ field: "tag:finance", value: null, evidenceQuote: null, confidence: 0.5 }],
      }),
    ];
    const job = enqueue(fixture.db, 1, "metadata", "null-tag", fixture.ctx.configHash);
    const worker = new Worker(fixture.ctx);
    vi.spyOn(worker, "discover").mockResolvedValue();
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("done");
    expect(fixture.docs.get(1)?.tags).toEqual([99, 11]);
    expect(
      fixture.db.prepare("SELECT * FROM changes WHERE field_name='tag:finance'").get(),
    ).toMatchObject({ status: "staged", proposed_value_json: "null" });
  });

  it.each([
    "queued",
    "retry_wait",
  ] as const)("supersedes stale %s jobs without failed tags and discovers the current configuration", async (state) => {
    fixture = new Fixture((config) => {
      config.ocr.enabled = false;
    });
    const old = enqueue(fixture.db, 1, "metadata", "old-config", "old-config");
    updateJob(fixture.db, old.id, {
      state,
      next_attempt_at: state === "retry_wait" ? "2099-01-01T00:00:00.000Z" : null,
    });
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    expect(getJob(fixture.db, old.id)).toMatchObject({
      state: "failed",
      last_error: "Superseded by newer configuration",
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(
      fixture.db.prepare("SELECT * FROM jobs WHERE config_hash=?").all(fixture.ctx.configHash),
    ).toEqual([expect.objectContaining({ state: "done" })]);
    expect(fixture.docs.get(1)).toMatchObject({ document_type: 2, correspondent: 1, tags: [99] });
    expect(
      fixture.calls
        .filter((call) => call.url.pathname.endsWith("/bulk_edit/"))
        .some((call) => JSON.stringify(call.body).includes('"add_tags":[12]')),
    ).toBe(false);
  });
  it("resumes a transient gate failure without repeating L2, L3 or completed checks", async () => {
    const { worker, job } = setup();
    fixture.completions = [
      JSON.stringify({
        fields: [
          {
            field: "custom:total",
            value: "1.234,56 EUR",
            evidenceQuote: "Total 1.234,56 EUR",
            confidence: 0.99,
          },
          {
            field: "custom:invoice_date",
            value: "21.11.2026",
            evidenceQuote: "Date 21.11.2026",
            confidence: 0.99,
          },
        ],
      }),
    ];
    let checks = 0;
    fixture.fail = (url, init) => {
      if (url.host === "jev.test" && String(init.body).includes('"type":"noul"')) {
        checks++;
        if (checks === 2) return respond({}, 503);
      }
    };
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("retry_wait");
    const progress = JSON.parse(getJob(fixture.db, job.id)?.response_json ?? "{}");
    expect(progress.checked).toHaveLength(1);
    expect(progress.extracted).toHaveLength(2);
    updateJob(fixture.db, job.id, { next_attempt_at: null });
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("done");
    expect(fixture.providerCalls("cloud.test")).toHaveLength(1);
    expect(fixture.providerCalls("jev.test")).toHaveLength(5);
    expect(checks).toBe(3);
    expect(fixture.docs.get(1)?.custom_fields).toEqual([
      { field: 101, value: "1234.56" },
      { field: 102, value: "2026-11-21" },
    ]);
  });

  it("does not automatically repeat an exhausted JSON repair cycle", async () => {
    const { worker, job } = setup();
    fixture.completions = ["invalid", "still invalid"];
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("failed");
    await worker.tick();
    expect(fixture.providerCalls("cloud.test")).toHaveLength(2);
    expect(fixture.providerCalls("jev.test")).toHaveLength(2);
  });

  it("does not reuse extraction evidence after the source content changes", async () => {
    const { worker, job } = setup();
    fixture.fail = (url) => (url.host === "cloud.test" ? respond({}, 503) : undefined);
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("retry_wait");
    const doc = fixture.docs.get(1);
    if (doc) doc.content = "Human replaced source text";
    updateJob(fixture.db, job.id, { next_attempt_at: null });
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("failed");
    expect(fixture.providerCalls("cloud.test")).toHaveLength(1);
    expect(fixture.providerCalls("jev.test")).toHaveLength(2);
  });
});

describe("durable OCR worker recovery", () => {
  it("defers an exhausted page budget until next UTC midnight without consuming attempts or mutating tags", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T23:59:00Z"));
    fixture = new Fixture((config) => {
      config.ocr.maxPagesPerDay = 2;
    });
    fixture.docs.set(1, document(1, { tags: [99] }));
    const spent = enqueue(fixture.db, 99, "ocr", "already-spent", fixture.ctx.configHash);
    updateJob(fixture.db, spent.id, {
      state: "done",
      usage_json: JSON.stringify({ reservedPages: 2, budgetDate: "2026-11-21" }),
    });
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE doc_id=1").get() as { id: string };
    expect(getJob(fixture.db, job.id)).toMatchObject({
      state: "retry_wait",
      attempts: 0,
      next_attempt_at: "2026-11-22T00:00:00.000Z",
      last_error: "Daily OCR page budget exhausted",
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(fixture.docs.get(1)?.tags).toEqual([99]);
    expect(fixture.calls.filter((call) => call.method !== "GET")).toHaveLength(0);
    vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
    await worker.tick();
    expect(getJob(fixture.db, job.id)).toMatchObject({ state: "done", attempts: 1 });
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });

  it("retains upload intent across network retries and never uploads a duplicate derivative", async () => {
    fixture = new Fixture((config) => {
      config.ocr.versionMode = "derivative";
    });
    fixture.docs.set(1, document(1, { tags: [99] }));
    const upload = vi
      .spyOn(fixture.ctx.paperless, "uploadVersion")
      .mockRejectedValue(new NetworkError("Paperless"));
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE doc_id=1").get() as { id: string };
    expect(getJob(fixture.db, job.id)?.state).toBe("retry_wait");
    expect(JSON.parse(getJob(fixture.db, job.id)?.usage_json ?? "{}")).toMatchObject({
      uploadIntent: true,
      reservedPages: 2,
    });
    updateJob(fixture.db, job.id, { next_attempt_at: null });
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("retry_wait");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
    // Reconciliation finds the upload that completed after its response was lost.
    fixture.docs.get(1)?.versions.unshift({
      id: 10001,
      is_root: false,
      version_label: `mistral-ocr:v1:pending:${getSource(fixture.db, 1)?.source_sha256?.slice(0, 12)}`,
    });
    updateJob(fixture.db, job.id, { next_attempt_at: null });
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("done");
    expect(JSON.parse(getJob(fixture.db, job.id)?.usage_json ?? "{}")).not.toHaveProperty(
      "uploadIntent",
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("clears uploadIntent on explicit operator retry so a failed upload can be retried after reconciling", async () => {
    fixture = new Fixture((config) => {
      config.ocr.versionMode = "derivative";
      config.polling.maxAttempts = 1;
    });
    fixture.docs.set(1, document(1, { tags: [99] }));
    const upload = vi
      .spyOn(fixture.ctx.paperless, "uploadVersion")
      .mockRejectedValueOnce(new NetworkError("Paperless"));
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE doc_id=1").get() as { id: string };
    expect(getJob(fixture.db, job.id)?.state).toBe("failed");
    expect(JSON.parse(getJob(fixture.db, job.id)?.usage_json ?? "{}")).toMatchObject({
      uploadIntent: true,
      reservedPages: 2,
    });
    retryJob(fixture.ctx, job.id);
    const afterRetry = getJob(fixture.db, job.id);
    expect(afterRetry?.state).toBe("queued");
    expect(JSON.parse(afterRetry?.usage_json ?? "{}")).not.toHaveProperty("uploadIntent");
    expect(JSON.parse(afterRetry?.usage_json ?? "{}")).toMatchObject({ reservedPages: 2 });
    upload.mockRestore();
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("done");
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });

  it.each([
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ])("skips untagged %s originals after the cutoff", async (mime_type) => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { mime_type, tags: [99] }));
    const job = enqueue(fixture.db, 1, "ocr", "non-pdf", fixture.ctx.configHash);
    await new Worker(fixture.ctx).tick();
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("skipped");
    expect(getJob(fixture.db, job.id)?.state).toBe("done");
    expect(fixture.docs.get(1)?.tags).toEqual([99]);
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
  });

  it("skips non-PDF bytes even when the MIME type claims PDF", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { mime_type: "application/pdf", tags: [99] }));
    vi.spyOn(fixture.ctx.paperless, "downloadVersionPdf").mockResolvedValue(
      Buffer.from("PNG bytes"),
    );
    await new Worker(fixture.ctx).tick();
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("skipped");
    expect(fixture.db.prepare("SELECT state FROM jobs WHERE doc_id=1").get()).toEqual({
      state: "done",
    });
    expect(fixture.docs.get(1)?.tags).toEqual([99]);
  });

  it("reconsiders a skipped original when a new version arrives", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { tags: [99] }));
    vi.spyOn(fixture.ctx.paperless, "downloadVersionPdf").mockResolvedValueOnce(
      Buffer.from("PNG bytes"),
    );
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    await worker.tick();
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("skipped");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
    fixture.docs.get(1)?.versions.unshift({ id: 2, is_root: false, version_label: null });
    await worker.tick();
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });

  it("retries a rate-limited OCR request without marking it uncertain", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { tags: [99] }));
    fixture.fail = (url) => (url.host === "api.mistral.ai" ? respond({}, 429) : undefined);
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE doc_id=1").get() as { id: string };
    expect(getJob(fixture.db, job.id)).toMatchObject({ state: "retry_wait", usage_json: null });
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("discovered");
    fixture.fail = undefined;
    updateJob(fixture.db, job.id, { next_attempt_at: null });
    await worker.tick();
    expect(getJob(fixture.db, job.id)?.state).toBe("done");
    expect(fixture.docs.get(1)?.tags).toEqual([99]);
  });

  it("fails immediately when a single document exceeds maxPagesPerDay instead of bouncing daily", async () => {
    fixture = new Fixture((config) => {
      config.ocr.maxPagesPerDay = 5;
    });
    fixture.docs.set(1, document(1, { page_count: 10, tags: [99] }));
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE doc_id=1").get() as {
      id: string;
      state: string;
    };
    expect(job.state).toBe("failed");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
  });
});
