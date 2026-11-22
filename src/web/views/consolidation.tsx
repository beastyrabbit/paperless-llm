import type { Proposal } from "../../db/store.js";
import { parseJson } from "../../util.js";
import { Alert, dateText, Empty, Ledger, Mark, Part, Scale, Stamp } from "./components.js";
import { Layout, type Shell } from "./layout.js";

export interface ReferenceCheck {
  blockers: string[];
  checked: boolean;
}
export const mergePayload = (p: Proposal) =>
  parseJson<{ canonicalId: number; retiredIds: number[]; names: Record<string, string> }>(
    p.payload_json,
    { canonicalId: 0, retiredIds: [], names: {} },
  );
export function Scan({
  running = false,
  error,
  completed = false,
}: {
  running?: boolean;
  error?: string;
  completed?: boolean;
}) {
  return (
    <section
      class="part"
      id="scan"
      aria-labelledby="h-scan"
      hx-get={running ? "/consolidation/scan/status" : undefined}
      hx-trigger={running ? "every 2s" : undefined}
      hx-swap="outerHTML"
    >
      <div class="part-margin">
        <h2 id="h-scan">Scan</h2>
      </div>
      <div>
        <form
          class="actions"
          method="post"
          action="/consolidation/scan"
          hx-post="/consolidation/scan"
          hx-target="#scan"
          hx-swap="outerHTML"
          hx-disabled-elt="#scan button"
        >
          <button class="btn btn-primary" type="submit" disabled={running}>
            {running ? "Scan running" : "Run consolidation scan"}
          </button>
          <span class="working">Comparing catalog names</span>
          <p class="actions-note">
            {completed
              ? "Scan finished. Review the proposals below."
              : "A scan reads catalog names and document headers. It changes nothing in Paperless and may use Jev."}
          </p>
        </form>
        {error && <Alert>{error}</Alert>}
      </div>
    </section>
  );
}
export function Merge({
  proposal: p,
  threshold,
  check = { checked: false, blockers: [] },
  disabled,
  externalUrl,
  error,
  result,
}: {
  proposal: Proposal;
  threshold: number;
  check?: ReferenceCheck;
  disabled?: boolean;
  externalUrl: string;
  error?: string;
  result?: string;
}) {
  const payload = mergePayload(p),
    url = `/consolidation/proposals/${p.id}`,
    target = `#merge-${p.id}`;
  const blocked = !check.checked || check.blockers.length > 0;
  return (
    <article
      class="merge"
      id={`merge-${p.id}`}
      aria-labelledby={`mt-${p.id}`}
      tabindex={result ? -1 : undefined}
    >
      <div class="merge-margin">
        <p class="merge-kind">{p.entity_kind.replace("_", " ")}</p>
        <dl class="facts">
          <div>
            <dt>Equivalence</dt>
            <dd>
              {p.score === null ? (
                "Not recorded"
              ) : (
                <Scale p={p.score} t={threshold} label="Jev equivalence" />
              )}
            </dd>
          </div>
        </dl>
      </div>
      <div class="merge-body">
        <h3 class="vh" id={`mt-${p.id}`}>
          Merge {payload.retiredIds.map((id) => payload.names[id] ?? id).join(", ")} into{" "}
          {payload.names[payload.canonicalId]}
        </h3>
        <div class="merge-map">
          <div class="merge-from">
            {payload.retiredIds.map((id) => (
              <div class="merge-name" key={id}>
                <h4>{payload.names[id] ?? `No. ${id}`}</h4>
                <p class="label">Retiring name</p>
              </div>
            ))}
          </div>
          <div class="merge-join" aria-hidden="true" />
          <div class="merge-into">
            <p class="label">Stays</p>
            <h4>{payload.names[payload.canonicalId] ?? `No. ${payload.canonicalId}`}</h4>
            <p>Documents move to this name. The journal records each change.</p>
          </div>
        </div>
        {result ? (
          <div class="decided">
            <Stamp text={result} date={p.resolved_at} rejected={p.status === "rejected"} />
            <p class="decided-text">
              {p.batch_id
                ? "The batch is listed under Applied merges."
                : "This proposal has been dismissed."}
            </p>
          </div>
        ) : (
          <>
            <div class={`refcheck${blocked ? " refcheck-warn" : ""}`} id={`why-${p.id}`}>
              <Mark kind={blocked ? "unsure" : "ok"}>
                <div>
                  <b>
                    {!check.checked
                      ? "References have not been verified"
                      : check.blockers.length
                        ? "References prevent this merge"
                        : "No workflow, mail rule or saved view uses the retiring names"}
                  </b>
                  {check.blockers.length > 0 && (
                    <ul>
                      {check.blockers.map((ref) => (
                        <li key={ref}>{ref}</li>
                      ))}
                    </ul>
                  )}
                  {blocked && (
                    <p>
                      Change references in <a href={externalUrl}>Paperless</a>, then check again.
                      This service does not edit reference rules.
                    </p>
                  )}
                </div>
              </Mark>
            </div>
            <form
              class="actions"
              method="post"
              action={`${url}/approve`}
              hx-target={target}
              hx-swap="outerHTML swap:120ms"
              hx-disabled-elt={`${target} button`}
              hx-indicator={target}
            >
              <button
                class="btn btn-primary"
                type="submit"
                hx-post={`${url}/approve`}
                disabled={disabled || blocked}
                aria-describedby={blocked ? `why-${p.id}` : undefined}
              >
                Approve merge
              </button>
              <button
                class="btn"
                type="submit"
                formaction={`${url}/recheck`}
                hx-post={`${url}/recheck`}
              >
                Check references again
              </button>
              <button
                class="btn"
                type="submit"
                formaction={`${url}/dismiss`}
                hx-post={`${url}/dismiss`}
              >
                Dismiss
              </button>
              <span class="working">Checking Paperless</span>
            </form>
          </>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </article>
  );
}
export function Batch({
  proposal: p,
  error,
  result,
}: {
  proposal: Proposal;
  error?: string;
  result?: string;
}) {
  const payload = mergePayload(p),
    url = `/consolidation/merges/${p.batch_id}/undo`;
  const warnings = parseJson<{ warnings?: string[] }>(p.evidence_json, {}).warnings ?? [];
  return (
    <tr id={`batch-${p.batch_id}`} tabindex={result ? -1 : undefined}>
      <td data-label="Applied">{dateText(p.resolved_at)}</td>
      <td class="cell-main" data-label="Retired names">
        {payload.retiredIds.map((id) => payload.names[id] ?? id).join(", ")}
        <small>{p.entity_kind.replace("_", " ")}</small>
      </td>
      <td data-label="Merged into">{payload.names[payload.canonicalId]}</td>
      <td data-label="Batch">
        <code>{p.batch_id}</code>
      </td>
      <td class="cell-wide">
        {p.status === "undone" ? (
          <Stamp text="Undone" date={p.resolved_at} />
        ) : (
          <form
            method="post"
            action={url}
            hx-post={url}
            hx-target={`#batch-${p.batch_id}`}
            hx-swap="outerHTML"
            hx-confirm="Undo this merge? Retired names will be restored. Documents changed outside this service are preserved."
            hx-disabled-elt={`#batch-${p.batch_id} button`}
          >
            <button class="btn btn-small" type="submit">
              Undo merge
            </button>
            <span class="working">Restoring the batch</span>
          </form>
        )}
        {warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        {result && p.status !== "undone" && <p>{result}</p>}
        {error && <Alert>{error}</Alert>}
      </td>
    </tr>
  );
}
export function MergeList({
  proposals,
  threshold,
  checks,
  disabled,
  externalUrl,
  oob = false,
}: {
  proposals: Proposal[];
  threshold: number;
  checks: Map<string, ReferenceCheck>;
  disabled?: boolean;
  externalUrl: string;
  oob?: boolean;
}) {
  const pending = proposals.filter((p) => p.status === "pending");
  return (
    <div id="proposals" hx-swap-oob={oob ? "true" : undefined}>
      {pending.length ? (
        pending.map((p) => (
          <Merge
            key={p.id}
            proposal={p}
            threshold={threshold}
            check={checks.get(p.id)}
            disabled={disabled}
            externalUrl={externalUrl}
          />
        ))
      ) : (
        <Part id="no-merges" title="No merges proposed.">
          <Empty title="No names need a merge.">
            Run a scan to check the current catalog. A completed scan lists any matching names here.
          </Empty>
          <form
            method="post"
            action="/consolidation/scan"
            hx-post="/consolidation/scan"
            hx-target="#scan"
            hx-swap="outerHTML"
          >
            <button class="btn" type="submit">
              Run consolidation scan
            </button>
          </form>
        </Part>
      )}
    </div>
  );
}
export function AppliedMerges({
  proposals,
  oob = false,
}: {
  proposals: Proposal[];
  oob?: boolean;
}) {
  const applied = proposals.filter(
    (p) => p.batch_id && (p.status === "approved" || p.status === "undone"),
  );
  return (
    <div id="applied-merges" hx-swap-oob={oob ? "true" : undefined}>
      {applied.length ? (
        <Ledger
          id="merges"
          headings={["Applied", "Retired names", "Merged into", "Batch", "Action"]}
        >
          <tbody>
            {applied.map((p) => (
              <Batch key={p.id} proposal={p} />
            ))}
          </tbody>
        </Ledger>
      ) : (
        <Empty title="No merges applied yet." />
      )}
    </div>
  );
}
export function ConsolidationPage({
  proposals,
  shell,
  threshold,
  checks,
  running,
}: {
  proposals: Proposal[];
  shell: Shell;
  threshold: number;
  checks: Map<string, ReferenceCheck>;
  running?: boolean;
}) {
  return (
    <Layout
      title="Catalog consolidation"
      active="consolidation"
      shell={shell}
      lede="A scan finds names that may mean the same thing and proposes one name. Nothing changes in Paperless until you approve a merge."
      summary={
        <dl class="infoblock">
          <div>
            <dt>Merges proposed</dt>
            <dd>{proposals.filter((p) => p.status === "pending").length}</dd>
          </div>
          <div>
            <dt>Equivalence threshold</dt>
            <dd>{threshold.toFixed(2)}</dd>
          </div>
        </dl>
      }
    >
      <Scan running={running} />
      <Part id="proposals" title="Merge proposals" lead>
        <p>Check the names that retire, the name that stays, and what Paperless still points at.</p>
      </Part>
      <MergeList
        proposals={proposals}
        threshold={threshold}
        checks={checks}
        disabled={Boolean(shell.unavailable)}
        externalUrl={shell.externalUrl}
      />
      <Part
        id="applied"
        title="Applied merges"
        wide
        note="Undo restores retired names and journaled values where documents have not been edited outside this service."
      >
        <AppliedMerges proposals={proposals} />
      </Part>
    </Layout>
  );
}
