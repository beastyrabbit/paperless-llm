import { afterEach, describe, expect, it } from "vitest";
import { enqueue, getJob, getSource, saveSource, updateJob } from "../src/db/store.js";
import {
  derivativePdf,
  discoverOcr,
  marker,
  reconcile,
  runOcr,
} from "../src/pipeline/layer1Ocr.js";
import { claim, recoverLeases, retryJob, Worker } from "../src/pipeline/worker.js";
import { dailyPages } from "../src/providers/mistral.js";
import { now, sha256 } from "../src/util.js";
import { document, Fixture, respond } from "./helpers.js";

let fixture: Fixture;
afterEach(() => fixture?.close());
describe("paid OCR safety", () => {
  it("makes a DB-loss pending marker visible as an uncertain job and permits an explicitly confirmed retry", async () => {
    fixture = new Fixture();
    fixture.docs.set(
      1,
      document(1, {
        versions: [{ id: 1, is_root: true, version_label: marker("pending", "a".repeat(64)) }],
      }),
    );
    await reconcile(fixture.ctx);
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE state='uncertain'").get() as {
      id: string;
    };
    expect(job).toBeDefined();
    retryJob(fixture.ctx, job.id, true);
    await discoverOcr(fixture.ctx);
    const claimed = claim(fixture.ctx, "test-owner");
    if (!claimed) throw new Error("fixture");
    expect(await runOcr(fixture.ctx, 1, claimed)).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });
  it("retains upload intent after a lost derivative response and never duplicates the upload", async () => {
    fixture = new Fixture((config) => {
      config.ocr.versionMode = "derivative";
    });
    fixture.fail = (url) => {
      if (url.pathname.endsWith("/update_version/")) throw new Error("lost upload response");
      return undefined;
    };
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow("Paperless: request failed or timed out");
    fixture.fail = undefined;
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow("upload outcome unknown");
    expect(
      fixture.calls.filter((call) => call.url.pathname.endsWith("/update_version/")),
    ).toHaveLength(1);
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });
  it("discovers tagless documents after cutoff only", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { tags: [] }));
    fixture.docs.set(2, document(2, { added: "2020-01-01T00:00:00Z" }));
    const jobs = await discoverOcr(fixture.ctx);
    expect(jobs.map((job) => job.doc_id)).toEqual([1]);
    expect(fixture.calls[0]?.url.searchParams.get("added__gte")).toBe("2026-11-01");
    expect(await runOcr(fixture.ctx, 2)).toBe("skipped");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
  });
  it("writes an attempt and budget reservation before Mistral; verifies in-place content and final label", async () => {
    fixture = new Fixture();
    fixture.onOcr = () => {
      expect(getSource(fixture.db, 1)?.ocr_status).toBe("running");
      expect(fixture.db.prepare("SELECT state,config_hash FROM jobs").get()).toEqual({
        state: "running",
        config_hash: fixture.ctx.configHash,
      });
      expect(dailyPages(fixture.db)).toBe(2);
    };
    expect(await runOcr(fixture.ctx, 1)).toBe("done");
    const source = getSource(fixture.db, 1);
    expect(source).toMatchObject({
      ocr_status: "done",
      ocr_pages: 2,
      source_version_id: 1,
      output_version_id: 1,
    });
    expect(source?.content_hash).toBe(sha256(fixture.docs.get(1)?.content ?? ""));
    expect(fixture.docs.get(1)?.versions[0]?.version_label).toBe(
      marker("done", source?.source_sha256 ?? ""),
    );
    expect(fixture.providerCalls("api.mistral.ai")[0]?.body).toMatchObject({ pages: [0, 1] });
    expect(await runOcr(fixture.ctx, 1)).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });
  it.each([
    400, 404, 405,
  ])("falls back to a byte-distinct derivative on root label HTTP %i", async (status) => {
    fixture = new Fixture();
    fixture.labelRootStatus = status;
    await runOcr(fixture.ctx, 1);
    expect(getSource(fixture.db, 1)?.output_version_id).toBe(10_001);
    const upload = fixture.calls.find((call) => call.url.pathname.endsWith("/update_version/"));
    const form = upload?.body as FormData;
    const pdf = form.get("document") as Blob;
    expect(await pdf.text()).toContain("source-sha256=");
    expect(String(form.get("version_label")).length).toBeLessThanOrEqual(64);
    expect(fixture.calls.some((call) => call.url.pathname === "/api/tasks/")).toBe(true);
  });
  it("honours explicit derivative mode and does not fall back on auth errors", async () => {
    fixture = new Fixture((config) => {
      config.ocr.versionMode = "derivative";
    });
    await runOcr(fixture.ctx, 1);
    expect(getSource(fixture.db, 1)?.output_version_id).toBe(10_001);
    fixture.close();
    fixture = new Fixture();
    fixture.labelRootStatus = 403;
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow("403");
    expect(fixture.calls.some((call) => call.url.pathname.endsWith("/update_version/"))).toBe(
      false,
    );
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("pending_write");
  });
  it("resumes saved results after write failure without buying OCR again", async () => {
    fixture = new Fixture();
    fixture.fail = (url, init) =>
      init.method === "PATCH" && url.searchParams.has("version") ? respond({}, 503) : undefined;
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow();
    expect(getSource(fixture.db, 1)?.ocr_text).toContain("[Page 1]");
    fixture.fail = undefined;
    expect(await runOcr(fixture.ctx, 1)).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(1);
  });
  it("refuses unknown pages and budget overruns before paid calls", async () => {
    fixture = new Fixture((config) => {
      config.ocr.maxPagesPerDay = 1;
    });
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow("budget");
    const doc = fixture.docs.get(1);
    if (doc) doc.page_count = null;
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow("page count");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
  });
  it("retains uncertain spend and requires explicit confirmation for a second request", async () => {
    fixture = new Fixture();
    fixture.ocrError = new Error("connection lost");
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow();
    const job = fixture.db.prepare("SELECT * FROM jobs").get() as { id: string };
    expect(getJob(fixture.db, job.id)?.state).toBe("uncertain");
    expect(await runOcr(fixture.ctx, 1)).toBe("uncertain");
    expect(await discoverOcr(fixture.ctx)).toEqual([]);
    expect(() => retryJob(fixture.ctx, job.id)).toThrow("Confirm retry");
    expect(dailyPages(fixture.db)).toBe(2);
    retryJob(fixture.ctx, job.id, true);
    fixture.ocrError = undefined;
    await runOcr(fixture.ctx, 1, getJob(fixture.db, job.id));
    expect(dailyPages(fixture.db)).toBe(4);
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(2);
  });
  it("requeues uncertain jobs only when auto-retry was explicitly enabled", async () => {
    fixture = new Fixture((config) => {
      config.ocr.allowAutoRetryUncertain = true;
    });
    fixture.ocrError = new Error("lost");
    await expect(runOcr(fixture.ctx, 1)).rejects.toThrow();
    await discoverOcr(fixture.ctx);
    expect((fixture.db.prepare("SELECT state FROM jobs").get() as { state: string }).state).toBe(
      "queued",
    );
  });
  it("reconciles done and pending labels after DB loss without spending", async () => {
    fixture = new Fixture();
    fixture.docs.set(
      1,
      document(1, {
        versions: [
          { id: 9, version_label: null, is_root: false },
          { id: 1, version_label: marker("done", "a".repeat(64)), is_root: true },
        ],
      }),
    );
    fixture.docs.set(
      2,
      document(2, {
        versions: [{ id: 2, version_label: marker("pending", "b".repeat(64)), is_root: true }],
      }),
    );
    expect(await reconcile(fixture.ctx)).toBe(2);
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("done");
    expect(getSource(fixture.db, 2)?.ocr_status).toBe("uncertain");
    expect(await runOcr(fixture.ctx, 2)).toBe("uncertain");
    expect(await runOcr(fixture.ctx, 1)).toBe("done");
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
  });
  it("rejects non-PDF derivative input", () => {
    expect(() => derivativePdf(Buffer.from("not pdf"), "abc")).toThrow("PDF");
  });
});
describe("worker journal", () => {
  it("claims each queued job once and recovers expired paid calls as uncertain", () => {
    fixture = new Fixture();
    const job = enqueue(fixture.db, 1, "ocr", "one", fixture.ctx.configHash);
    expect(claim(fixture.ctx, "a")?.id).toBe(job.id);
    expect(claim(fixture.ctx, "b")).toBeUndefined();
    saveSource(fixture.db, { doc_id: 1, ocr_status: "running" });
    updateJob(fixture.db, job.id, { lease_expires_at: "2000-01-01T00:00:00.000Z" });
    recoverLeases(fixture.ctx);
    expect(getJob(fixture.db, job.id)?.state).toBe("uncertain");
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("uncertain");
  });
  it("recovers saved OCR work safely and performs empty-DB reconcile before polling", async () => {
    fixture = new Fixture();
    const worker = new Worker(fixture.ctx);
    const doc = fixture.docs.get(1);
    if (doc?.versions[0]) doc.versions[0].version_label = marker("done", "a".repeat(64));
    await worker.initialize();
    expect(getSource(fixture.db, 1)?.ocr_status).toBe("done");
    const job = enqueue(fixture.db, 1, "ocr", "saved", fixture.ctx.configHash);
    saveSource(fixture.db, {
      doc_id: 1,
      ocr_status: "pending_write",
      ocr_text: "saved",
      content_hash: sha256("saved"),
    });
    updateJob(fixture.db, job.id, {
      state: "running",
      lease_expires_at: now().replace(/^\d{4}/, "2000"),
    });
    recoverLeases(fixture.ctx);
    expect(getJob(fixture.db, job.id)?.state).toBe("retry_wait");
  });
  it("backs off transient failures and shuts down gracefully", async () => {
    fixture = new Fixture((config) => {
      config.ocr.enabled = false;
      config.polling.batchSize = 1;
    });
    fixture.fail = (url) => (url.host === "jev.test" ? respond({}, 503) : undefined);
    const worker = new Worker(fixture.ctx);
    await worker.tick();
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE stage='metadata'").get() as {
      id: string;
    };
    expect(getJob(fixture.db, job.id)?.state).toBe("retry_wait");
    expect(getJob(fixture.db, job.id)?.next_attempt_at).not.toBeNull();
    await worker.stop();
  });
});
