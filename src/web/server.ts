import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Hono, type Context as HttpContext } from "hono";
import { type Child, Fragment, jsx } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { redactedConfig, type Secrets } from "../config/index.js";
import { blockingReferences, execute, scan, undo } from "../consolidation/engine.js";
import { type Change, getJob, type Proposal as ProposalRow } from "../db/store.js";
import { legalResponse } from "../legal/render.js";
import { approveReview, rejectReview, resolveProposal } from "../pipeline/apply.js";
import type { Context } from "../pipeline/context.js";
import { retryJob } from "../pipeline/worker.js";
import { now } from "../util.js";
import {
  docTitle,
  filteredJobs,
  mergeProposals,
  type RunFilters,
  reviewData,
  shellData,
  stripData,
} from "./model.js";
import { ActivityPage, Run, Runs, Strip } from "./views/activity.js";
import { Alert } from "./views/components.js";
import { ConfigPage } from "./views/config.js";
import {
  AppliedMerges,
  Batch,
  ConsolidationPage,
  Merge,
  MergeList,
  mergePayload,
  type ReferenceCheck,
  Scan,
} from "./views/consolidation.js";
import { ResponseFragments } from "./views/fragments.js";
import {
  CandidateChoices,
  Documents,
  Proposal,
  ReviewPage,
  Slip,
  Waiting,
} from "./views/review.js";

const positiveId = z.coerce.number().int().positive();
const uuid = z.string().uuid();
const isHtmx = (c: HttpContext) => c.req.header("HX-Request") === "true";
class ActionError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
  }
}
export function createApp(ctx: Context, secrets: Secrets = {}) {
  const app = new Hono();
  let mutations: Promise<unknown> = Promise.resolve();
  let scanTask: Promise<void> | undefined;
  let scanError: string | undefined;
  const serialize = <T>(action: () => Promise<T> | T): Promise<T> => {
    const result = mutations.then(action);
    mutations = result.catch(() => {});
    return result;
  };
  const proposal = (id: string, kind?: ProposalRow["proposal_kind"]) => {
    const row = ctx.db.prepare("SELECT * FROM proposals WHERE id=?").get(uuid.parse(id)) as
      | ProposalRow
      | undefined;
    if (!row || (kind && row.proposal_kind !== kind))
      throw new ActionError(404, "Proposal not found. Refresh the page to see current decisions.");
    return row;
  };
  const checkReferences = async (p: ProposalRow): Promise<ReferenceCheck> => {
    const refs = await ctx.paperless.references();
    return {
      checked: true,
      blockers: [
        ...new Set(
          mergePayload(p).retiredIds.flatMap((id) => blockingReferences(refs, id, p.entity_kind)),
        ),
      ],
    };
  };
  const consolidationData = async () => {
    const proposals = mergeProposals(ctx),
      checks = new Map<string, ReferenceCheck>(),
      shell = shellData(ctx);
    const pending = proposals.filter((p) => p.status === "pending");
    if (pending.length) {
      try {
        const refs = await ctx.paperless.references();
        for (const p of pending)
          checks.set(p.id, {
            checked: true,
            blockers: [
              ...new Set(
                mergePayload(p).retiredIds.flatMap((id) =>
                  blockingReferences(refs, id, p.entity_kind),
                ),
              ),
            ],
          });
      } catch {
        shell.unavailable = `Reference checks failed at ${now()}.`;
      }
    }
    return {
      proposals,
      checks,
      shell,
      externalUrl: shell.externalUrl,
      threshold: ctx.config.jev.thresholds.consolidation,
    };
  };
  const fragments = async (c: HttpContext, children: Child, message: string) =>
    ResponseFragments({
      children,
      message,
      shell: shellData(ctx),
      review: /^\/(?:review\/|actions\/(?:proposals|review)\/)/.test(c.req.path)
        ? await reviewData(ctx, false)
        : undefined,
      strip: /^\/(?:activity\/|actions\/jobs\/)/.test(c.req.path) ? stripData(ctx) : undefined,
    });
  const finish = async (c: HttpContext, path: string, children: Child, message: string) =>
    isHtmx(c) ? c.html(await fragments(c, children, message)) : c.redirect(path, 303);
  const filters = (c: HttpContext): RunFilters => ({
    status: z
      .enum([
        "",
        "action",
        "requested",
        "review",
        "queued",
        "running",
        "retry_wait",
        "failed",
        "uncertain",
        "done",
      ])
      .parse(c.req.query("status") ?? c.req.query("state") ?? ""),
    stage: z.enum(["", "ocr", "metadata", "consolidation"]).parse(c.req.query("stage") ?? ""),
    q: z
      .string()
      .max(200)
      .parse(c.req.query("q") ?? ""),
  });
  const titles = (jobs: { doc_id: number }[]) =>
    new Map(jobs.map((j) => [j.doc_id, docTitle(ctx, j.doc_id)]));
  const actionFailure = async (c: HttpContext, message: string, status: ContentfulStatusCode) => {
    const path = c.req.path;
    const parts = path.split("/");
    const id = parts.at(-2) ?? "";
    let child: Child = Alert({ children: message });
    try {
      if (/\/(names|proposals)\//.test(path) && !path.startsWith("/consolidation")) {
        const p = proposal(id);
        if (p.proposal_kind === "new_entity")
          child = Proposal({
            proposal: p,
            data: await reviewData(ctx, false),
            open: path.endsWith("/map"),
            error: message,
          });
      } else if (/\/(documents|review)\//.test(path)) {
        child = Slip({
          docId: positiveId.parse(id),
          data: await reviewData(ctx, false),
          error: message,
        });
      } else if (/\/(runs|jobs)\//.test(path)) {
        const job = getJob(ctx.db, uuid.parse(id));
        if (job)
          child = Run({
            job,
            title: docTitle(ctx, job.doc_id),
            externalUrl: shellData(ctx).externalUrl,
            error: message,
          });
      } else if (path.includes("/scan")) child = Scan({ error: message });
      else if (path.includes("/merges/") && path.endsWith("/undo")) {
        const p = ctx.db.prepare("SELECT * FROM proposals WHERE batch_id=?").get(uuid.parse(id)) as
          | ProposalRow
          | undefined;
        if (p) child = Batch({ proposal: p, error: message });
      } else if (/\/(proposals|merges)\//.test(path)) {
        child = Merge({
          proposal: proposal(id, "merge"),
          externalUrl: shellData(ctx).externalUrl,
          threshold: ctx.config.jev.thresholds.consolidation,
          error: message,
        });
      }
    } catch {
      /* Malformed or removed targets still receive an escaped error. */
    }
    return c.html(child, status);
  };
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("Cache-Control", "no-store");
    c.header("Vary", "HX-Request");
    const target = new URL(c.req.url);
    const host = c.req.header("host") ?? target.host;
    if (!(c.req.method === "GET" && c.req.path === "/health")) {
      let hostname: string;
      try {
        const parsed = new URL(`http://${host}`);
        if (parsed.host.toLowerCase() !== host.toLowerCase()) throw new Error("Invalid Host");
        hostname = parsed.hostname.toLowerCase();
      } catch {
        return actionFailure(c, "Host is not allowed.", 403);
      }
      const allowed = ctx.config.server.allowedHosts.map((entry) => entry.toLowerCase());
      const loopback = ["localhost", "127.0.0.1", "[::1]"];
      const hostAllowed = allowed.length
        ? allowed.includes(host.toLowerCase()) || allowed.includes(hostname)
        : loopback.includes(hostname);
      if (!hostAllowed) return actionFailure(c, "Host is not allowed.", 403);
    }
    if (c.req.method === "POST") {
      const origin = c.req.header("origin"),
        referer = c.req.header("referer");
      target.host = host;
      const protocol = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
      if (protocol === "https" || protocol === "http") target.protocol = `${protocol}:`;
      let sameOrigin = origin === target.origin;
      if (!origin && referer) {
        try {
          sameOrigin = new URL(referer).origin === target.origin;
        } catch {
          sameOrigin = false;
        }
      }
      if (!sameOrigin || c.req.header("sec-fetch-site") === "cross-site")
        return actionFailure(
          c,
          "Same-origin request required. Reload this page before submitting again.",
          403,
        );
    }
    await next();
  });
  app.onError((error, c) =>
    actionFailure(
      c,
      error instanceof z.ZodError
        ? "Invalid action input. Check the selected values and try again."
        : error instanceof ActionError
          ? error.message
          : "Action failed. A remote write may already have happened. Inspect the current document and journal before retrying.",
      error instanceof z.ZodError ? 400 : error instanceof ActionError ? error.status : 409,
    ),
  );
  app.get("/health", (c) => {
    ctx.db.prepare("SELECT 1").get();
    return c.json({ status: "ok" });
  });
  const version = () => ({
    version: process.env.APP_VERSION ?? "0.1.0",
    revision: process.env.APP_REVISION ?? "dev",
  });
  app.get("/version", (c) => c.json(version()));
  app.get("/api/version", (c) => c.json(version()));
  app.get("/privacy", () => legalResponse("en", "privacy"));
  app.get("/datenschutz", () => legalResponse("de", "privacy"));
  app.get("/impressum", () => legalResponse("de", "notice"));
  app.get("/legal-notice", () => legalResponse("en", "notice"));
  const assets = new Map<string, { file: URL | string; type: string }>([
    [
      "/assets/styles.css",
      { file: new URL("./public/styles.css", import.meta.url), type: "text/css; charset=utf-8" },
    ],
    [
      "/assets/htmx.min.js",
      {
        file: existsSync(new URL("./public/htmx.min.js", import.meta.url))
          ? new URL("./public/htmx.min.js", import.meta.url)
          : createRequire(import.meta.url).resolve("htmx.org/dist/htmx.min.js"),
        type: "text/javascript; charset=utf-8",
      },
    ],
    ...readdirSync(new URL("./public/fonts/", import.meta.url))
      .filter((f) => f.endsWith(".woff2"))
      .map(
        (f) =>
          [
            `/assets/fonts/${f}`,
            { file: new URL(`./public/fonts/${f}`, import.meta.url), type: "font/woff2" },
          ] as const,
      ),
  ]);
  for (const [path, asset] of assets)
    app.get(path, (c) => {
      c.header("Content-Type", asset.type);
      c.header(
        "Cache-Control",
        asset.type === "font/woff2"
          ? "public, max-age=86400"
          : "public, max-age=0, must-revalidate",
      );
      return c.body(new Uint8Array(readFileSync(asset.file)));
    });
  app.get("/", async (c) =>
    c.html("<!doctype html>" + ReviewPage({ data: await reviewData(ctx) })),
  );
  app.get("/consolidation", async (c) =>
    c.html(
      "<!doctype html>" +
        ConsolidationPage({ ...(await consolidationData()), running: Boolean(scanTask) }),
    ),
  );
  for (const path of ["/activity", "/activity/runs"])
    app.get(path, (c) => {
      const selected = filters(c),
        jobs = filteredJobs(ctx, selected),
        shell = shellData(ctx),
        props = { jobs, filters: selected, titles: titles(jobs), shell, strip: stripData(ctx) };
      return c.html(
        isHtmx(c)
          ? Runs({ ...props, externalUrl: shell.externalUrl })
          : "<!doctype html>" + ActivityPage(props),
      );
    });
  app.get("/activity/strip", (c) => c.html(Strip({ data: stripData(ctx) })));
  app.get("/config", (c) =>
    c.html(
      "<!doctype html>" +
        ConfigPage({
          config: ctx.config,
          credentials: redactedConfig(ctx.config, secrets).credentials,
          configHash: ctx.configHash,
          shell: shellData(ctx),
        }),
    ),
  );
  for (const suffix of ["", "/map", "/candidates"])
    app.get(`/review/names/:id${suffix}`, async (c) => {
      const p = proposal(c.req.param("id"), "new_entity"),
        data = await reviewData(ctx),
        query = (c.req.query("q") ?? "").slice(0, 200);
      let entities = await ctx.paperless.listEntities(p.entity_kind);
      entities = entities
        .filter((e) => e.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .slice(0, 50);
      if (suffix === "/candidates" && isHtmx(c)) return c.html(CandidateChoices({ entities }));
      return c.html(
        isHtmx(c)
          ? Proposal({ proposal: p, data, open: suffix !== "", entities, query })
          : "<!doctype html>" +
              ReviewPage({ data, openId: suffix ? p.id : undefined, entities, query }),
      );
    });
  const nameAction = (action: "approve" | "reject" | "map") => async (c: HttpContext) =>
    serialize(async () => {
      const p = proposal(c.req.param("id") ?? "", "new_entity"),
        form = await c.req.formData();
      const affected = (
        ctx.db
          .prepare("SELECT DISTINCT doc_id FROM changes WHERE proposal_id=? AND status='staged'")
          .all(p.id) as { doc_id: number }[]
      ).map((r) => r.doc_id);
      await resolveProposal(
        ctx,
        p.id,
        action,
        action === "map" ? positiveId.parse(form.get("entityId") ?? form.get("target")) : undefined,
      );
      if (action === "reject") for (const docId of affected) await approveReview(ctx, docId, []);
      const data = await reviewData(ctx),
        updated = proposal(p.id, "new_entity");
      return finish(
        c,
        "/",
        jsx(
          Fragment,
          null,
          Proposal({
            proposal: updated,
            data,
            result: action === "reject" ? "Rejected" : action === "map" ? "Mapped" : "Created",
          }),
          Documents({ data, oob: true }),
          Waiting({ data, oob: true }),
        ),
        `${action === "reject" ? "Rejected" : action === "map" ? "Mapped" : "Created"} the proposed ${p.entity_kind.replace("_", " ")}. Waiting documents were checked.`,
      );
    });
  for (const action of ["approve", "reject", "map"] as const) {
    app.post(`/review/names/:id/${action}`, nameAction(action));
    app.post(`/actions/proposals/:id/${action}`, nameAction(action));
  }
  const reviewAction =
    (action: "approve" | "approve-selected" | "reject", legacy = false) =>
    async (c: HttpContext) =>
      serialize(async () => {
        const docId = positiveId.parse(c.req.param("id"));
        const held = ctx.db
          .prepare(
            "SELECT * FROM changes WHERE doc_id=? AND status IN ('staged','failed') AND kind='document_field'",
          )
          .all(docId) as Change[];
        if (!held.length)
          throw new ActionError(404, "No held changes found. Refresh the review queue.");
        let message: string, result: string;
        if (action === "reject") {
          await rejectReview(ctx, docId);
          result = "Rejected";
          message = `Rejected staged changes for document ${docId}. Existing values were kept.`;
        } else {
          let selected: string[] | undefined;
          if (
            action === "approve-selected" ||
            (!legacy && c.req.query("all") !== "1" && held.length > 1)
          ) {
            const form = await c.req.formData();
            selected = z.array(uuid).min(1).parse(form.getAll("changeIds"));
            if (selected.some((id) => !held.some((c) => c.id === id && c.status === "staged")))
              throw new ActionError(400, "Select staged fields from this document only.");
          }
          const outcome = await approveReview(ctx, docId, selected);
          result = outcome.conflicts.length ? "Partly approved" : "Approved";
          message = `Approved ${outcome.applied} fields for document ${docId}.`;
          if (outcome.conflicts.length)
            throw new ActionError(
              409,
              `${message} Other fields remain held because their values or dependencies could not be verified. Inspect the document before trying again.`,
            );
        }
        return finish(c, "/", Slip({ docId, data: await reviewData(ctx), result }), message);
      });
  for (const action of ["approve", "approve-selected", "reject"] as const) {
    app.post(`/review/documents/:id/${action}`, reviewAction(action));
    app.post(`/actions/review/:id/${action}`, reviewAction(action, true));
  }
  const startScan = async (c: HttpContext) => {
    if (!scanTask) {
      scanError = undefined;
      const task = serialize(async () => {
        await scan(ctx);
      });
      scanTask = task.then(
        () => {
          scanTask = undefined;
        },
        () => {
          scanError =
            "The scan failed. Check the catalog operation in Activity before running it again.";
          scanTask = undefined;
        },
      );
    }
    if (!isHtmx(c)) {
      await scanTask;
      return c.redirect("/consolidation", 303);
    }
    return finish(c, "/consolidation", Scan({ running: true }), "Consolidation scan started.");
  };
  app.post("/consolidation/scan", startScan);
  app.post("/actions/consolidation/scan", startScan);
  app.get("/consolidation/scan/status", async (c) => {
    const data = await consolidationData();
    return c.html(
      await fragments(
        c,
        jsx(
          Fragment,
          null,
          Scan({
            running: Boolean(scanTask),
            error: scanError,
            completed: !scanTask && !scanError,
          }),
          MergeList({ ...data, oob: true }),
        ),
        scanTask ? "Consolidation scan is running." : (scanError ?? "Consolidation scan finished."),
      ),
    );
  });
  const mergeAction = (action: "approve" | "dismiss" | "recheck") => async (c: HttpContext) =>
    serialize(async () => {
      const p = proposal(c.req.param("id") ?? "", "merge");
      if (p.status !== "pending")
        throw new ActionError(409, "This merge proposal has already been decided.");
      let check: ReferenceCheck | undefined;
      if (action === "dismiss")
        ctx.db
          .prepare(
            "UPDATE proposals SET status='rejected',resolved_at=? WHERE id=? AND status='pending'",
          )
          .run(now(), p.id);
      else {
        check = await checkReferences(p);
        if (action === "approve") {
          if (check.blockers.length)
            throw new ActionError(
              409,
              "Paperless still references a retiring name. Change those references and check again before approving.",
            );
          await execute(ctx, p.id);
        }
      }
      const updated = proposal(p.id, "merge");
      return finish(
        c,
        "/consolidation",
        jsx(
          Fragment,
          null,
          Merge({
            proposal: updated,
            externalUrl: shellData(ctx).externalUrl,
            threshold: ctx.config.jev.thresholds.consolidation,
            check,
            result:
              action === "approve" ? "Approved" : action === "dismiss" ? "Dismissed" : undefined,
          }),
          action === "approve"
            ? AppliedMerges({ proposals: mergeProposals(ctx), oob: true })
            : null,
        ),
        action === "recheck"
          ? "Paperless references checked."
          : `Merge ${action === "approve" ? "approved" : "dismissed"}.`,
      );
    });
  for (const action of ["approve", "dismiss", "recheck"] as const) {
    app.post(`/consolidation/proposals/:id/${action}`, mergeAction(action));
    app.post(`/actions/merges/:id/${action}`, mergeAction(action));
  }
  const undoMerge = async (c: HttpContext) =>
    serialize(async () => {
      const batchId = uuid.parse(c.req.param("id")),
        p = ctx.db
          .prepare("SELECT * FROM proposals WHERE batch_id=? AND proposal_kind='merge'")
          .get(batchId) as ProposalRow | undefined;
      if (!p || p.status !== "approved")
        throw new ActionError(404, "Applied merge batch not found.");
      const outcome = await undo(ctx, batchId),
        updated = proposal(p.id, "merge");
      if (outcome.results.some((r) => r.status !== "undone"))
        throw new ActionError(
          409,
          "Some changes could not be undone. Human edits were preserved. Inspect the batch in Paperless.",
        );
      return finish(
        c,
        "/consolidation",
        Batch({ proposal: updated }),
        "Merge undone. Retired names and eligible document values were restored.",
      );
    });
  app.post("/consolidation/merges/:id/undo", undoMerge);
  app.post("/actions/merges/:id/undo", undoMerge);
  const retry = (confirm: boolean) => async (c: HttpContext) =>
    serialize(async () => {
      const jobId = uuid.parse(c.req.param("id"));
      if (confirm)
        z.literal("retry-may-double-charge").parse((await c.req.formData()).get("confirm"));
      const before = getJob(ctx.db, jobId);
      if (!before) throw new ActionError(404, "Job not found.");
      if (confirm && (before.stage !== "ocr" || before.state !== "uncertain"))
        throw new ActionError(409, "This job is not an uncertain OCR call. Refresh Activity.");
      retryJob(ctx, jobId, confirm);
      const job = getJob(ctx.db, jobId);
      if (!job) throw new ActionError(404, "Job not found.");
      return finish(
        c,
        "/activity",
        Run({ job, title: docTitle(ctx, job.doc_id), externalUrl: shellData(ctx).externalUrl }),
        `Queued a retry for document ${job.doc_id}.`,
      );
    });
  app.post("/activity/runs/:id/retry", retry(false));
  app.post("/actions/jobs/:id/retry", retry(false));
  app.post("/activity/runs/:id/confirm-ocr-retry", retry(true));
  app.post("/actions/jobs/:id/confirm-retry", retry(true));
  return app;
}
