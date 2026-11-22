import type { Job } from "../../db/store.js";
import { parseJson } from "../../util.js";
import type { RunFilters, StripData } from "../model.js";
import { Alert, dateText, Empty, Ledger, Mark, Part, Scale } from "./components.js";
import { Layout, type Shell } from "./layout.js";

export function Strip({ data, oob = false }: { data: StripData; oob?: boolean }) {
  return (
    <section
      class="strip"
      id="strip"
      aria-label="Current state"
      hx-get="/activity/strip"
      hx-trigger="every 30s"
      hx-swap="outerHTML"
      hx-swap-oob={oob ? "true" : undefined}
    >
      <div class="strip-cell strip-budget">
        <p class="label">Mistral OCR pages reserved today</p>
        <p class="strip-value">
          {data.used} <small>of {data.limit}</small>
        </p>
        <Scale
          plain
          p={data.limit ? data.used / data.limit : 0}
          t={1}
          label="Daily OCR budget"
          read={`${data.used} of ${data.limit} pages`}
        />
        <p class="strip-note">
          {Math.max(0, data.limit - data.used)} left. Includes reservations for uncertain calls.
          Resets at 00:00 UTC.
        </p>
      </div>
      {(
        [
          [
            data.tags.requested,
            data.queued,
            "/activity?status=requested",
            "active documents in the local queue",
          ],
          [data.tags.review, data.review, "/", "wait for you"],
          [data.tags.failed, data.failed, "/activity?status=failed", "documents with failed runs"],
          ["Uncertain paid OCR", data.uncertain, "/activity?status=uncertain", "billing unknown"],
        ] as const
      ).map(([title, value, href, note]) => (
        <a class="strip-cell strip-count" href={href} key={title}>
          <span class="label">{title}</span>
          <span class="strip-value">{value}</span>
          <span class="strip-note">{note}</span>
        </a>
      ))}
      <div class="strip-cell strip-reconcile">
        <p class="label">Last reconcile</p>
        <p class="strip-value">{dateText(data.reconcile)}</p>
        <p class="strip-note">
          Last successful reconciliation with Paperless document versions. Run reconcile after
          restoring the database.
        </p>
      </div>
    </section>
  );
}
const kind = (state: Job["state"]) =>
  state === "done" ? "ok" : state === "failed" ? "fail" : state === "uncertain" ? "unsure" : "none";
const stateText = (state: Job["state"]) =>
  ({
    done: "Done",
    failed: "Failed",
    uncertain: "Uncertain",
    running: "Running",
    queued: "Queued",
    retry_wait: "Waiting to retry",
  })[state];
export function Run({
  job,
  title,
  externalUrl,
  error,
}: {
  job: Job;
  title: string;
  externalUrl: string;
  error?: string;
}) {
  const flag = job.state === "failed" || job.state === "uncertain",
    uncertain = job.state === "uncertain";
  const url = `/activity/runs/${job.id}/${uncertain ? "confirm-ocr-retry" : "retry"}`;
  const usage = parseJson<{ reservedPages?: number }>(job.usage_json, {});
  const accounting = parseJson<
    {
      provider?: string;
      usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    }[]
  >(job.usage_json, []);
  const tokens = Array.isArray(accounting)
    ? accounting.reduce(
        (total, record) =>
          total +
          (record.usage?.total_tokens ??
            (record.usage?.prompt_tokens ?? 0) + (record.usage?.completion_tokens ?? 0)),
        0,
      )
    : null;
  return (
    <tbody id={`run-${job.id}`} class={flag ? "run-flag" : undefined}>
      <tr>
        <td class="cell-main">
          {job.doc_id ? (
            <a href={`${externalUrl}/documents/${job.doc_id}/details`}>{title}</a>
          ) : (
            "Catalog operation"
          )}
          <small>{job.doc_id ? `No. ${job.doc_id}` : job.idempotency_key.split(":")[0]}</small>
        </td>
        <td data-label="Started">{dateText(job.created_at)}</td>
        <td data-label="Stage" class="stage">
          {job.stage === "ocr"
            ? "L1 OCR"
            : job.stage === "metadata"
              ? "L2 classification and L3 extraction"
              : "Catalog"}
          <small>{job.attempts} attempts</small>
        </td>
        <td data-label="Usage">
          {usage.reservedPages !== undefined
            ? `${usage.reservedPages} pages reserved`
            : tokens === null
              ? "Not recorded"
              : `${tokens} tokens recorded`}
        </td>
        <td data-label="Outcome" class="outcome">
          <Mark kind={kind(job.state)}>{stateText(job.state)}</Mark>
        </td>
      </tr>
      {(flag || error) && (
        <tr class="reason-row">
          <td colspan={5}>
            <div class={`reason${uncertain ? " reason-unsure" : ""}`}>
              <p class="reason-text">
                <b>
                  {uncertain
                    ? "The OCR call may have been billed, and no confirmed result was saved"
                    : "The run stopped before completion"}
                </b>
                {job.last_error ?? "Inspect the current state before retrying."}{" "}
                {uncertain
                  ? `Retrying can charge for ${usage.reservedPages ?? "the document's"} pages again. The daily limit still applies.`
                  : job.stage === "metadata"
                    ? "A retry uses the saved metadata progress and makes no OCR request."
                    : job.stage === "consolidation"
                      ? "Inspect the batch, then start a fresh catalog operation."
                      : "A retry reuses saved OCR text when available; otherwise a paid request may be needed."}
              </p>
              {flag && job.stage !== "consolidation" && (
                <form
                  class="actions"
                  method="post"
                  action={url}
                  hx-post={url}
                  hx-target={`#run-${job.id}`}
                  hx-swap="outerHTML"
                  hx-disabled-elt={`#run-${job.id} button`}
                >
                  {uncertain && (
                    <input type="hidden" name="confirm" value="retry-may-double-charge" />
                  )}
                  <button class={`btn${uncertain ? " btn-primary" : ""}`} type="submit">
                    {uncertain ? "Confirm OCR retry" : "Retry"}
                  </button>
                  <span class="working">Queuing the run</span>
                </form>
              )}
              {error && <Alert>{error}</Alert>}
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}
export function Runs({
  jobs,
  filters,
  titles,
  externalUrl,
}: {
  jobs: Job[];
  filters: RunFilters;
  titles: Map<number, string>;
  externalUrl: string;
}) {
  return (
    <div id="runs">
      {jobs.length ? (
        <Ledger
          headings={["Document", "Started", "Stage", "Usage", "Outcome"]}
          caption="Up to 200 newest journaled jobs. Provider usage is shown only where recorded."
        >
          {jobs.map((job) => (
            <Run
              key={job.id}
              job={job}
              title={titles.get(job.doc_id) ?? `Document ${job.doc_id}`}
              externalUrl={externalUrl}
            />
          ))}
        </Ledger>
      ) : (
        <Empty
          title={
            filters.status || filters.stage || filters.q
              ? "No runs match these filters."
              : "Nothing has run yet."
          }
        >
          {filters.status || filters.stage || filters.q ? (
            <a href="/activity">Clear filters</a>
          ) : (
            <>Tag a document in Paperless to request processing.</>
          )}
        </Empty>
      )}
    </div>
  );
}
export function ActivityPage({
  jobs,
  filters,
  titles,
  shell,
  strip,
}: {
  jobs: Job[];
  filters: RunFilters;
  titles: Map<number, string>;
  shell: Shell;
  strip: StripData;
}) {
  return (
    <Layout
      title="Activity and failures"
      active="activity"
      shell={shell}
      lede="What ran, what usage was recorded, and what stopped. Failed jobs can be retried; an uncertain paid OCR call needs your explicit decision."
    >
      <Strip data={strip} />
      <Part
        id="runs"
        title="Runs"
        wide
        note="One row per durable job. Metadata jobs record classification and extraction together."
      >
        <form
          class="filters"
          id="run-filters"
          method="get"
          action="/activity/runs"
          hx-get="/activity/runs"
          hx-target="#runs"
          hx-swap="outerHTML"
          hx-trigger="change, input changed delay:300ms from:#f-q, submit"
          hx-push-url="true"
        >
          <fieldset class="filter">
            <legend class="label">Outcome</legend>
            <div class="seg">
              {[
                ["", "All"],
                ["action", "Needs action"],
                ["review", "In review"],
                ["done", "Done"],
                ["requested", "Queued and running"],
                ["failed", "Failed"],
                ["uncertain", "Uncertain"],
              ].map(([value, text]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="status"
                    value={value}
                    checked={filters.status === value}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div class="filter">
            <label class="label" for="f-stage">
              Stage
            </label>
            <select id="f-stage" name="stage">
              {[
                ["", "Any stage"],
                ["ocr", "L1 OCR"],
                ["metadata", "L2 and L3 metadata"],
                ["consolidation", "Catalog"],
              ].map(([v, t]) => (
                <option key={v} value={v} selected={filters.stage === v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="filter filter-grow">
            <label class="label" for="f-q">
              Saved title or document number
            </label>
            <input type="search" id="f-q" name="q" value={filters.q} placeholder="Telekom, 1482" />
          </div>
          <button class="btn" type="submit">
            Filter runs
          </button>
        </form>
        <Runs jobs={jobs} filters={filters} titles={titles} externalUrl={shell.externalUrl} />
      </Part>
    </Layout>
  );
}
