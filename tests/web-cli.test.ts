import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/cli.js";
import {
  type Change,
  enqueue,
  getJob,
  type Proposal,
  propose,
  recordChange,
  saveSource,
  updateJob,
} from "../src/db/store.js";
import { applyCandidates } from "../src/pipeline/apply.js";
import { createApp } from "../src/web/server.js";
import { document, Fixture } from "./helpers.js";

let fixture: Fixture;
afterEach(() => fixture?.close());
const post = (body: Record<string, string> = {}, origin = "http://localhost") => ({
  method: "POST",
  headers: { Origin: origin },
  body: new URLSearchParams(body),
});
describe("Hono application", () => {
  it("rejects spoofed matching Host and Origin headers outside the allowlist", async () => {
    fixture = new Fixture((config) => {
      config.server.allowedHosts = ["paperless-llm.test"];
    });
    recordChange(fixture.db, { docId: 1, field: "title", original: "", proposed: "Approved" });
    const app = createApp(fixture.ctx);
    expect(
      (
        await app.request("http://evil.test/actions/review/1/approve", {
          method: "POST",
          headers: { Host: "evil.test", Origin: "http://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect(fixture.docs.get(1)?.title).toBe("");
    expect(
      (
        await app.request("http://paperless-llm.test/actions/review/1/approve", {
          method: "POST",
          headers: { Host: "evil.test", Origin: "http://evil.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("http://paperless-llm.test/actions/review/1/approve", {
          method: "POST",
          headers: { Host: "paperless-llm.test", Origin: "http://paperless-llm.test" },
        })
      ).status,
    ).toBe(303);
    expect(fixture.docs.get(1)?.title).toBe("Approved");
  });
  it("restricts an empty allowlist to loopback when bound to loopback", async () => {
    fixture = new Fixture((config) => {
      config.server.host = "127.0.0.1";
    });
    const app = createApp(fixture.ctx);
    expect(
      (await app.request("http://evil.test/actions/review/1/reject", post({}, "http://evil.test")))
        .status,
    ).toBe(403);
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      recordChange(fixture.db, { docId: 1, field: "title", original: "", proposed: "Rejected" });
      expect(
        (await app.request(`http://${host}/actions/review/1/reject`, post({}, `http://${host}`)))
          .status,
      ).toBe(303);
    }
  });
  it("highlights quotes across OCR line breaks and repeated whitespace", async () => {
    fixture = new Fixture();
    fixture.docs.set(
      1,
      document(1, { content: "Before\nAcme   GmbH\nTotal\n  1.234,56 EUR\nAfter" }),
    );
    recordChange(fixture.db, {
      docId: 1,
      field: "title",
      original: "",
      proposed: "Review",
      evidence: "Acme GmbH Total 1.234,56 EUR",
    });
    const html = await (await createApp(fixture.ctx).request("/")).text();
    expect(html).toContain("<mark>Acme   GmbH\nTotal\n  1.234,56 EUR</mark>");
    expect(html).not.toContain("Quote not found word for word");
  });
  it("accepts same-origin forms through a TLS-terminating proxy", async () => {
    fixture = new Fixture((config) => {
      config.server.allowedHosts = ["paperless-llm.test"];
    });
    const app = createApp(fixture.ctx);
    recordChange(fixture.db, { docId: 1, field: "title", original: "", proposed: "Approved" });
    const response = await app.request("http://paperless-llm.test/actions/review/1/approve", {
      method: "POST",
      headers: { Origin: "https://paperless-llm.test", "X-Forwarded-Proto": "https" },
    });
    expect(response.status).toBe(303);
    expect(fixture.docs.get(1)?.title).toBe("Approved");
  });
  it("serves health, version metadata and all four preserved legal routes", async () => {
    fixture = new Fixture();
    vi.stubEnv("APP_VERSION", "1.2.3");
    vi.stubEnv("APP_REVISION", "a".repeat(40));
    const app = createApp(fixture.ctx);
    expect(await (await app.request("/health")).json()).toEqual({ status: "ok" });
    for (const path of ["/version", "/api/version"]) {
      const response = await app.request(path);
      expect(await response.json()).toEqual({ version: "1.2.3", revision: "a".repeat(40) });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    for (const path of ["/privacy", "/datenschutz", "/impressum", "/legal-notice"]) {
      const response = await app.request(path),
        html = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("<html");
      expect(html).toContain(
        path === "/datenschutz" || path === "/impressum" ? 'lang="de"' : 'lang="en"',
      );
    }
    vi.unstubAllEnvs();
  });
  it("renders all empty workbench pages with legal links and redacted credentials", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx, { paperlessToken: "fixture-never-render-me" });
    for (const path of ["/", "/consolidation", "/activity", "/config"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("<main");
      expect(html).toContain('class="desk"');
      expect(html).toContain('class="colophon"');
      expect(html).toContain('name="htmx-config"');
      expect(html).toContain('src="/assets/htmx.min.js"');
      for (const legal of ["/privacy", "/datenschutz", "/impressum", "/legal-notice"])
        expect(html).toContain(`href="${legal}"`);
      expect(html).not.toContain("fixture-never-render-me");
    }
    expect((await app.request("/assets/styles.css")).headers.get("content-type")).toContain(
      "text/css",
    );
    expect(fixture.calls).toHaveLength(0);
    expect(await (await app.request("/")).text()).toContain("Nothing is held for review.");
    const consolidation = await (await app.request("/consolidation")).text();
    expect(consolidation).toContain("No merges proposed.");
    expect(consolidation).toContain("No merges applied yet.");
    expect(await (await app.request("/activity")).text()).toContain("Nothing has run yet.");
  });
  it("rejects cross-origin, missing-origin, and DNS-rebound hosts on GET and POST while allowing /health", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    expect(
      (await app.request("/actions/consolidation/scan", post({}, "http://evil.test"))).status,
    ).toBe(403);
    expect((await app.request("/actions/consolidation/scan", { method: "POST" })).status).toBe(403);
    // Default config binds 0.0.0.0 with empty allowedHosts: non-loopback Host must be rejected on GET and POST.
    expect((await app.request("/", { headers: { Host: "evil.test:3765" } })).status).toBe(403);
    expect(
      (
        await app.request("/actions/consolidation/scan", {
          method: "POST",
          headers: { Host: "evil.test:3765", Origin: "http://evil.test:3765" },
        })
      ).status,
    ).toBe(403);
    // Kubelet /health probes use the pod IP as Host and must remain reachable.
    expect((await app.request("/health", { headers: { Host: "10.42.0.15:3765" } })).status).toBe(
      200,
    );
    expect(fixture.calls).toHaveLength(0);
    // Configured allowedHosts permits the explicit hostname on GET and POST.
    fixture.close();
    fixture = new Fixture((config) => {
      config.server.allowedHosts = ["paperless.home.arpa"];
    });
    const allowedApp = createApp(fixture.ctx);
    expect(
      (await allowedApp.request("/", { headers: { Host: "paperless.home.arpa" } })).status,
    ).toBe(200);
    expect((await allowedApp.request("/", { headers: { Host: "evil.test" } })).status).toBe(403);
  });
  it("approves/rejects review forms, swaps htmx components and escapes evidence", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    const changeId = recordChange(fixture.db, {
      docId: 1,
      field: "title",
      original: "",
      proposed: "<script>alert(1)</script>",
      evidence: "<img src=x>",
    });
    const page = await (await app.request("/")).text();
    expect(page).toContain("&lt;img");
    expect(page).not.toContain("<img src=x>");
    expect(
      (await app.request("/actions/review/1/approve-selected", post({ changeIds: changeId })))
        .status,
    ).toBe(303);
    expect(fixture.docs.get(1)?.title).toBe("<script>alert(1)</script>");
    recordChange(fixture.db, {
      docId: 1,
      field: "title",
      original: "<script>alert(1)</script>",
      proposed: "new",
    });
    const response = await app.request("/actions/review/1/reject", {
      ...post(),
      headers: { Origin: "http://localhost", "HX-Request": "true" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("HX-Redirect")).toBeNull();
    const partial = await response.text();
    expect(partial).toContain('id="doc-1"');
    expect(partial).toContain("Rejected");
    expect(partial).not.toContain('id="strip"');
    expect(partial).not.toContain("<html");
    for (const id of [
      "count-review",
      "count-consolidation",
      "count-activity",
      "review-summary",
      "announce",
    ])
      expect(partial).toMatch(new RegExp(`id="${id}"[^>]*hx-swap-oob="true"`));
    expect(
      fixture.db.prepare("SELECT * FROM changes WHERE status='staged'").all() as Change[],
    ).toHaveLength(0);
  });
  it("serves self-hosted CSS, htmx and every font with content types and cache headers", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    for (const [path, contentType] of [
      ["/assets/styles.css", "text/css"],
      ["/assets/htmx.min.js", "text/javascript"],
      ...[
        "fira-sans-400",
        "fira-sans-500",
        "fira-sans-600",
        "fira-sans-condensed-500",
        "fira-sans-condensed-600",
        "courier-prime-400",
      ].map((name) => [`/assets/fonts/${name}.woff2`, "font/woff2"]),
    ]) {
      const response = await app.request(path ?? "");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect(response.headers.get("cache-control")).toContain("public");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);
    }
    const css = await (await app.request("/assets/styles.css")).text();
    expect(css).toContain("./fonts/fira-sans-400.woff2");
    expect(css).not.toContain("400-italic");
    expect(css).not.toContain("courier-prime-700");
    expect((await app.request("/assets/fonts/fira-sans-400-italic.woff2")).status).toBe(404);
    expect((await app.request("/assets/../../package.json")).status).toBe(404);
  });
  it("highlights OCR quotes with escaped JSX nodes and shows held and folded saved fields", async () => {
    fixture = new Fixture();
    const quote = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    fixture.docs.set(
      1,
      document(1, { content: `Before\n${quote}\nAfter`, title: "Invoice with evidence" }),
    );
    recordChange(fixture.db, {
      docId: 1,
      field: "title",
      original: "",
      proposed: "Reviewed title",
      evidence: quote,
      confidence: 0.6,
      checks: { grounded: true, semantic: { value: false, confidence: 0.6 } },
    });
    recordChange(fixture.db, {
      docId: 1,
      field: "created",
      original: null,
      proposed: "2026-11-21",
      status: "applied",
    });
    recordChange(fixture.db, { docId: 1, field: "correspondent", original: null, proposed: 1 });
    const html = await (await createApp(fixture.ctx).request("/")).text();
    expect(html).toContain("<mark>&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html).toContain('class="scale scale-under"');
    expect(html).toContain('class="applied"');
    expect(html).toContain('name="changeIds"');
    expect(html).toContain("Approve selected");
  });
  it("returns in-place errors without OOB changes and preserves serialized mutations", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    recordChange(fixture.db, { docId: 1, field: "title", original: "", proposed: "Approved once" });
    const request = { ...post(), headers: { Origin: "http://localhost", "HX-Request": "true" } };
    const responses = await Promise.all([
      app.request("/review/documents/1/approve?all=1", request),
      app.request("/review/documents/1/approve?all=1", request),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 404]);
    const error = await responses[1]?.text();
    expect(error).toContain('class="alert alert-error');
    expect(error).not.toContain('hx-swap-oob="true"');
    const invalid = await app.request("/review/documents/not-an-id/approve", request);
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("Invalid action input");
    const csrf = await app.request("/review/documents/1/reject", {
      ...request,
      headers: { ...request.headers, Origin: "http://evil.test" },
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.text()).toContain('class="alert alert-error');
    expect(fixture.docs.get(1)?.title).toBe("Approved once");
  });
  it("opens, searches, closes and submits the inline mapping panel with and without htmx", async () => {
    fixture = new Fixture();
    const p = propose(fixture.db, "new_entity", "correspondent", "inline-map", { name: "Alias" });
    recordChange(fixture.db, {
      docId: 1,
      proposalId: p.id,
      field: "correspondent",
      original: null,
      proposed: "Alias",
    });
    const app = createApp(fixture.ctx);
    const headers = { "HX-Request": "true" };
    const open = await (await app.request(`/review/names/${p.id}/map`, { headers })).text();
    expect(open).toContain(`id="map-${p.id}"`);
    expect(open).toContain('name="entityId" value="1"');
    const full = await (await app.request(`/review/names/${p.id}/map?q=Acme`)).text();
    expect(full).toContain("<html");
    expect(full).toContain("Acme GmbH");
    const candidates = await (
      await app.request(`/review/names/${p.id}/candidates?q=absent`, { headers })
    ).text();
    expect(candidates).toContain("No matching names");
    const closed = await (await app.request(`/review/names/${p.id}`, { headers })).text();
    expect(closed).not.toContain('class="panel"');
    const mapped = await app.request(`/review/names/${p.id}/map`, {
      ...post({ entityId: "1" }),
      headers: { Origin: "http://localhost", ...headers },
    });
    expect(mapped.status).toBe(200);
    const partial = await mapped.text();
    expect(partial).toContain("Mapped");
    expect(partial).toContain('id="documents" hx-swap-oob="true"');
    expect(partial).toContain('id="waiting" hx-swap-oob="true"');
    expect(fixture.docs.get(1)?.correspondent).toBe(1);
  });
  it("creates and rejects entity proposals and releases waiting documents", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    const created = propose(fixture.db, "new_entity", "tag", "new-tag", { name: "New tag" });
    recordChange(fixture.db, {
      docId: 1,
      proposalId: created.id,
      field: "tag:New tag",
      original: false,
      proposed: true,
    });
    expect((await app.request(`/review/names/${created.id}/approve`, post())).status).toBe(303);
    const entity = fixture.catalog.tags.find((t) => t.name === "New tag");
    expect(entity).toBeDefined();
    expect(fixture.docs.get(1)?.tags).toContain(entity?.id);
    const rejected = propose(fixture.db, "new_entity", "correspondent", "reject-name", {
      name: "Rejected name",
    });
    recordChange(fixture.db, {
      docId: 1,
      proposalId: rejected.id,
      field: "correspondent",
      original: null,
      proposed: "Rejected name",
    });
    expect((await app.request(`/review/names/${rejected.id}/reject`, post())).status).toBe(303);
    expect(fixture.docs.get(1)?.correspondent).toBeNull();
    expect(fixture.docs.get(1)?.tags).not.toContain(11);
  });
  it("filters activity with reloadable URLs, shows retry costs, reservations and last reconcile", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    const job = enqueue(fixture.db, 1, "ocr", "uncertain-pages", fixture.ctx.configHash);
    updateJob(fixture.db, job.id, {
      state: "uncertain",
      usage_json: JSON.stringify({
        reservedPages: 7,
        budgetDate: new Date().toISOString().slice(0, 10),
      }),
      last_error: "Paid call outcome unknown",
    });
    enqueue(fixture.db, 2, "metadata", "other-job", fixture.ctx.configHash);
    recordChange(fixture.db, {
      docId: 1,
      field: "title",
      original: "",
      proposed: "Searchable invoice",
      status: "applied",
    });
    await runCommand(["reconcile"], fixture.ctx);
    const html = await (
      await app.request("/activity?status=uncertain&stage=ocr&q=Searchable")
    ).text();
    expect(html).toContain(`id="run-${job.id}"`);
    expect(html).toContain("Confirm OCR retry");
    expect(html).toContain("7 pages reserved");
    expect(html).toContain("Resets at 00:00 UTC");
    expect(html).not.toContain("Not recorded</p>");
    const partial = await (
      await app.request("/activity/runs?status=uncertain&stage=ocr&q=1", {
        headers: { "HX-Request": "true" },
      })
    ).text();
    expect(partial).not.toContain("<html");
    expect(partial).toContain('id="runs"');
    expect(await (await app.request("/activity/runs?stage=metadata&q=missing")).text()).toContain(
      "No runs match these filters.",
    );
    expect(await (await app.request("/activity/strip")).text()).toContain('hx-trigger="every 30s"');
    const retry = await app.request(`/activity/runs/${job.id}/confirm-ocr-retry`, {
      ...post({ confirm: "retry-may-double-charge" }),
      headers: { Origin: "http://localhost", "HX-Request": "true" },
    });
    expect(retry.status).toBe(200);
    const retryHtml = await retry.text();
    expect(retryHtml).toContain("Queued");
    expect(retryHtml).toContain('id="strip"');
    expect(retryHtml).not.toContain('id="review-summary"');
    expect(getJob(fixture.db, job.id)?.state).toBe("queued");
  });
  it("blocks referenced merges, rechecks them, approves, and undoes by batch ID", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    const p = propose(
      fixture.db,
      "merge",
      "correspondent",
      "merge-ui",
      { canonicalId: 1, retiredIds: [3], names: { "1": "Acme GmbH", "3": "Acme AG" } },
      0.999,
    );
    fixture.references.mail_rules = [{ id: 8, assign_correspondent: 3 }];
    const app = createApp(fixture.ctx);
    const html = await (await app.request("/consolidation")).text();
    expect(html).toContain("refcheck refcheck-warn");
    expect(html).toContain('disabled="" aria-describedby=');
    expect((await app.request(`/consolidation/proposals/${p.id}/approve`, post())).status).toBe(
      409,
    );
    expect(fixture.docs.get(1)?.correspondent).toBe(3);
    fixture.references.mail_rules = [];
    const request = { ...post(), headers: { Origin: "http://localhost", "HX-Request": "true" } };
    const recheck = await (
      await app.request(`/consolidation/proposals/${p.id}/recheck`, request)
    ).text();
    expect(recheck).toContain("No workflow, mail rule or saved view");
    expect((await app.request(`/consolidation/proposals/${p.id}/approve`, request)).status).toBe(
      200,
    );
    const applied = fixture.db.prepare("SELECT * FROM proposals WHERE id=?").get(p.id) as Proposal;
    expect(applied.batch_id).toBeTruthy();
    const page = await (await app.request("/consolidation")).text();
    expect(page).toContain("Undo merge");
    expect(page).toContain("hx-confirm=");
    expect(
      (await app.request(`/consolidation/merges/${applied.batch_id}/undo`, request)).status,
    ).toBe(200);
    expect(fixture.docs.get(1)?.correspondent).not.toBe(1);
  });
  it("renders active schemas and tag behavior without inventing config or exposing secrets", async () => {
    fixture = new Fixture((c) => {
      c.tags.requested = "process:requested";
      c.documentTypes.Invoice = {
        openFields: [{ name: "total", kind: "monetary", required: true, semanticCheck: true }],
        selectFields: [],
        titleTemplate: "{created} Invoice",
      };
    });
    const app = createApp(fixture.ctx, {
      paperlessToken: "never-render-paperless",
      jevApiKey: "never-render-jev",
    });
    const html = await (await app.request("/config")).text();
    expect(html).toContain('class="schema"');
    expect(html).toContain("process:requested");
    expect(html).toContain("clean, in review or failed");
    expect(html).toContain('class="redacted"');
    expect(html).toContain("not set");
    expect(html).not.toContain("never-render-");
    expect(html).toContain("node dist/cli.js consolidate");
    expect(html).not.toContain("--dry-run");
  });
  it("keeps local review evidence visible and disables writes when Paperless is unavailable", async () => {
    fixture = new Fixture();
    saveSource(fixture.db, { doc_id: 1, ocr_status: "done", ocr_text: "Locally saved evidence" });
    recordChange(fixture.db, {
      docId: 1,
      field: "title",
      original: "",
      proposed: "Proposed title",
      evidence: "saved evidence",
    });
    vi.spyOn(fixture.ctx.paperless, "getDocument").mockRejectedValue(new Error("unavailable"));
    const app = createApp(fixture.ctx);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Paperless did not answer");
    expect(html).toContain("Locally <mark>saved evidence</mark>");
    expect(html).toMatch(/hx-post="\/review\/documents\/1\/approve\?all=1" disabled/);
  });
  it("polls a running scan and publishes its proposals when it finishes", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    const app = createApp(fixture.ctx);
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(fixture.ctx.paperless, "catalog").mockImplementationOnce(async () => {
      await barrier;
      return fixture.catalog;
    });
    const response = await app.request("/consolidation/scan", {
      ...post(),
      headers: { Origin: "http://localhost", "HX-Request": "true" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('hx-trigger="every 2s"');
    const running = await (await app.request("/consolidation/scan/status")).text();
    expect(running).toContain("Scan running");
    release();
    // A serialized form action waits for the scan before inspecting its result.
    await app.request("/review/documents/999/reject", post());
    const done = await (await app.request("/consolidation/scan/status")).text();
    expect(done).not.toContain('hx-trigger="every 2s"');
    expect(done).toContain('id="proposals" hx-swap-oob="true"');
    expect(done).toContain("Acme AG");
  });
  it("requires an explicit uncertain-retry confirmation and accepts ordinary failed retries", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    const job = enqueue(fixture.db, 1, "ocr", "retry", fixture.ctx.configHash);
    updateJob(fixture.db, job.id, { state: "uncertain" });
    expect((await app.request(`/actions/jobs/${job.id}/retry`, post())).status).toBe(409);
    expect((await app.request(`/actions/jobs/${job.id}/confirm-retry`, post())).status).toBe(400);
    expect(
      (
        await app.request(
          `/actions/jobs/${job.id}/confirm-retry`,
          post({ confirm: "retry-may-double-charge" }),
        )
      ).status,
    ).toBe(303);
    expect(getJob(fixture.db, job.id)?.state).toBe("queued");
    updateJob(fixture.db, job.id, { state: "failed" });
    expect((await app.request(`/actions/jobs/${job.id}/retry`, post())).status).toBe(303);
  });
  it("maps shared entity proposals through real action endpoints", async () => {
    fixture = new Fixture();
    const app = createApp(fixture.ctx);
    await applyCandidates(fixture.ctx, 1, [
      { field: "document_type", value: 2, passed: true, confidence: 1 },
      {
        field: "correspondent",
        value: "Alias",
        passed: false,
        confidence: 1,
        newEntity: { kind: "correspondent", name: "Alias" },
      },
    ]);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    expect(
      (await app.request(`/actions/proposals/${proposal.id}/map`, post({ entityId: "1" }))).status,
    ).toBe(303);
    expect(fixture.docs.get(1)?.correspondent).toBe(1);
    expect((await app.request("/actions/review/not-an-id/approve", post())).status).toBe(400);
  });
  it("triggers a consolidation scan and dismisses the resulting merge", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    const app = createApp(fixture.ctx);
    expect((await app.request("/actions/consolidation/scan", post())).status).toBe(303);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    expect((await app.request(`/actions/merges/${proposal.id}/dismiss`, post())).status).toBe(303);
    expect((await app.request(`/actions/merges/${proposal.id}/approve`, post())).status).toBe(409);
  });
});
describe("CLI commands", () => {
  it("calibrates read-only without Mistral or L3 spend", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { correspondent: 1, document_type: 2 }));
    const report = await runCommand(["calibrate"], fixture.ctx);
    expect(report).toMatchObject({
      documents: 1,
      fields: { correspondent: { shortlistRecall: 1, precisionAgainstExistingMetadata: 1 } },
    });
    expect(fixture.providerCalls("api.mistral.ai")).toHaveLength(0);
    expect(fixture.providerCalls("cloud.test")).toHaveLength(0);
    expect(
      fixture.calls.some((call) => call.url.host === "paperless.test" && call.method !== "GET"),
    ).toBe(false);
  });
  it("dispatches reconcile, consolidate and undo, and validates command arguments", async () => {
    fixture = new Fixture();
    expect(await runCommand(["reconcile"], fixture.ctx)).toEqual({ sources: 0 });
    expect(await runCommand(["consolidate"], fixture.ctx)).toEqual({ proposals: 0 });
    expect(await runCommand(["undo", "empty"], fixture.ctx)).toMatchObject({ results: [] });
    await expect(runCommand(["undo"], fixture.ctx)).rejects.toThrow("Usage");
    await expect(runCommand(["unknown"], fixture.ctx)).rejects.toThrow("Unknown");
  });
});
