import type { Context } from "../pipeline/context.js";
import { id, json, now, parseJson } from "../util.js";
import { enqueue, getJob, updateJob } from "./store.js";

// A journaled provider task can run outside the polling worker, e.g. a catalog scan.
export async function journal<T>(
  ctx: Context,
  label: string,
  action: (scoped: Context) => Promise<T>,
): Promise<T> {
  const job = enqueue(ctx.db, 0, "consolidation", `${label}:${id()}`, ctx.configHash);
  const lease = () => new Date(Date.now() + ctx.config.polling.leaseDurationMs).toISOString();
  updateJob(ctx.db, job.id, {
    state: "running",
    attempts: 1,
    lease_owner: job.id,
    lease_expires_at: lease(),
  });
  const account = (provider: string) => (usage: unknown) => {
    const history = parseJson<unknown[]>(getJob(ctx.db, job.id)?.usage_json ?? null, []);
    updateJob(ctx.db, job.id, { usage_json: json([...history, { provider, usage }]) });
  };
  const timer = setInterval(
    () => {
      ctx.db
        .prepare("UPDATE jobs SET lease_expires_at=? WHERE id=? AND state='running'")
        .run(lease(), job.id);
    },
    Math.max(250, ctx.config.polling.leaseDurationMs / 3),
  );
  try {
    const result = await action({
      ...ctx,
      jev: ctx.jev.withAccounting(account("jev")),
      llm: ctx.llm.withAccounting(account("llm")),
    });
    updateJob(ctx.db, job.id, {
      state: "done",
      response_json: json(result),
      lease_owner: null,
      lease_expires_at: null,
    });
    return result;
  } catch (error) {
    updateJob(ctx.db, job.id, {
      state: "failed",
      last_error: "Catalog operation failed; inspect batch before retrying",
      lease_owner: null,
      lease_expires_at: null,
      updated_at: now(),
    });
    throw error;
  } finally {
    clearInterval(timer);
  }
}
