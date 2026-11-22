import type { Change, Proposal as ProposalRow } from "../../db/store.js";
import type { Entity } from "../../paperless/client.js";
import { fieldValue } from "../../pipeline/apply.js";
import { equal, parseJson } from "../../util.js";
import { type ReviewData, waitingIds } from "../model.js";
import {
  Alert,
  dateText,
  display,
  Empty,
  Excerpt,
  Gate,
  Ledger,
  Mark,
  Part,
  Scale,
  Stamp,
} from "./components.js";
import { Layout } from "./layout.js";

const pending = (c: Change) => c.status === "staged" || c.status === "failed";
const name = (p: ProposalRow) => parseJson<{ name: string }>(p.payload_json, { name: "" }).name;
const label = (c: Change) =>
  c.field_name
    .replace(/^custom:/, "")
    .replace(/^tag:/, "Tag: ")
    .replaceAll("_", " ");
export function ReviewSummary({ data, oob = false }: { data: ReviewData; oob?: boolean }) {
  const waiting = waitingIds(data),
    docs = new Set(data.changes.filter(pending).map((c) => c.doc_id));
  return (
    <dl class="infoblock" id="review-summary" hx-swap-oob={oob ? "true" : undefined}>
      <div>
        <dt>New names to decide</dt>
        <dd>{data.proposals.length}</dd>
      </div>
      <div>
        <dt>Documents ready to review</dt>
        <dd>{docs.size - waiting.size}</dd>
      </div>
      <div>
        <dt>Documents waiting on a name</dt>
        <dd>{waiting.size}</dd>
      </div>
      <div>
        <dt>Oldest held since</dt>
        <dd>
          {dateText(
            data.changes
              .filter(pending)
              .map((c) => c.created_at)
              .sort()[0],
          )}
        </dd>
      </div>
    </dl>
  );
}
export function CandidateChoices({ entities }: { entities: Entity[] }) {
  return (
    <>
      {entities.length ? (
        entities.map((e) => (
          <label class="choice" key={e.id}>
            <input type="radio" name="entityId" value={e.id} required />
            <span>{e.name}</span>
            <span class="choice-facts">No. {e.id}</span>
          </label>
        ))
      ) : (
        <Empty title="No matching names in the catalog." />
      )}
    </>
  );
}
export function Proposal({
  proposal: p,
  data,
  open = false,
  entities = [],
  query = "",
  error,
  result,
}: {
  proposal: ProposalRow;
  data: ReviewData;
  open?: boolean;
  entities?: Entity[];
  query?: string;
  error?: string;
  result?: string;
}) {
  const url = `/review/names/${p.id}`,
    target = `#name-${p.id}`;
  const docs = [
    ...new Set(
      data.changes.filter((c) => c.proposal_id === p.id && pending(c)).map((c) => Number(c.doc_id)),
    ),
  ];
  const evidence = parseJson<{ quote?: string }>(p.evidence_json, {});
  return (
    <li class="proposal" id={`name-${p.id}`} tabindex={result ? -1 : undefined}>
      <div class="proposal-what">
        <p class="label">New {p.entity_kind.replace("_", " ")}</p>
        <h3 class="proposal-name">{name(p)}</h3>
        {result ? (
          <div class="decided">
            <Stamp text={result} date={p.resolved_at} rejected={p.status === "rejected"} />
            <p class="decided-text">
              Waiting documents were checked against their remaining dependencies.
            </p>
          </div>
        ) : (
          <>
            {evidence.quote && (
              <p class="quote">
                {evidence.quote}
                <cite class="quote-source">Evidence supplied with the proposal</cite>
              </p>
            )}
            <details class="holds">
              <summary>
                Releases {docs.length} {docs.length === 1 ? "document" : "documents"}
              </summary>
              <ul>
                {docs.map((id) => (
                  <li key={id}>
                    <a href={`${data.shell.externalUrl}/documents/${id}/details`}>
                      {data.documents.get(id)?.title || `Document ${id}`}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
      {!result && (
        <div class="proposal-side">
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
              disabled={Boolean(data.shell.unavailable)}
            >
              Create {p.entity_kind.replace("_", " ")}
            </button>
            <a
              class="btn"
              href={open ? "/" : `${url}/map`}
              hx-get={open ? url : `${url}/map`}
              hx-target={target}
              hx-swap="outerHTML"
              aria-expanded={open}
              aria-controls={`map-${p.id}`}
            >
              Map to existing
            </a>
            <button
              class="btn btn-danger"
              type="submit"
              formaction={`${url}/reject`}
              hx-post={`${url}/reject`}
              disabled={Boolean(data.shell.unavailable)}
            >
              Reject
            </button>
            <span class="working">Updating Paperless</span>
          </form>
        </div>
      )}
      {open && !result && (
        <form
          class="panel"
          id={`map-${p.id}`}
          method="post"
          action={`${url}/map`}
          hx-post={`${url}/map`}
          hx-target={target}
          hx-swap="outerHTML swap:120ms"
          hx-disabled-elt={`${target} button`}
          hx-indicator={target}
        >
          <fieldset>
            <legend>
              Use an existing {p.entity_kind.replace("_", " ")} instead of {name(p)}
            </legend>
            <div class="choices" id={`choices-${p.id}`}>
              <CandidateChoices entities={entities} />
            </div>
          </fieldset>
          <div class="filter">
            <label class="label" for={`map-${p.id}-q`}>
              Search the catalog
            </label>
            <input
              type="search"
              id={`map-${p.id}-q`}
              name="q"
              value={query}
              hx-get={`${url}/candidates`}
              hx-trigger="input changed delay:300ms"
              hx-target={`#choices-${p.id}`}
              hx-swap="innerHTML"
            />
            <button
              class="btn btn-small"
              type="submit"
              formmethod="get"
              formaction={`${url}/map`}
              formnovalidate
              hx-get={`${url}/map`}
              hx-target={target}
              hx-swap="outerHTML"
            >
              Search catalog
            </button>
          </div>
          <div class="actions">
            <button
              class="btn btn-primary"
              type="submit"
              disabled={Boolean(data.shell.unavailable)}
            >
              Map documents to this {p.entity_kind.replace("_", " ")}
            </button>
            <a class="btn btn-plain" href="/" hx-get={url} hx-target={target} hx-swap="outerHTML">
              Cancel
            </a>
            <span class="working">Writing to Paperless</span>
          </div>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </li>
  );
}
function Field({
  change: c,
  data,
  multiple,
}: {
  change: Change;
  data: ReviewData;
  multiple: boolean;
}) {
  const checks = parseJson<Record<string, unknown>>(c.check_results_json, {});
  const semantic = checks.semantic as { value: boolean; confidence: number } | undefined;
  const doc = data.documents.get(Number(c.doc_id));
  const text = doc?.content ?? data.sources.get(Number(c.doc_id))?.ocr_text ?? "";
  const current = doc
    ? fieldValue(doc, c.field_name, checks)
    : parseJson(c.original_value_json, null);
  const disabled =
    c.status !== "staged" ||
    checks.typeValid === false ||
    Boolean(c.proposal_id && data.proposals.some((p) => p.id === c.proposal_id));
  return (
    <div class="field">
      <div class="field-decide">
        {multiple ? (
          <label class="pick">
            <input
              type="checkbox"
              name="changeIds"
              value={c.id}
              disabled={disabled}
              checked={!disabled && !checks.humanConflict}
            />
            {label(c)}
          </label>
        ) : (
          <p class="pick">{label(c)}</p>
        )}
        <p class="field-value">
          {display(checks.displayValue ?? parseJson(c.proposed_value_json, null))}
          <small>
            {current === null || current === ""
              ? "Paperless has no value yet"
              : `Paperless has ${display(current)}`}
            {checks.humanConflict ? ", set outside this service" : ""}
          </small>
        </p>
        <ul class="gates">
          {(checks.grounded !== undefined || checks.typeValid !== undefined) && (
            <Gate
              state={checks.grounded === false || checks.typeValid === false ? "fail" : "pass"}
              title={
                checks.grounded === false || checks.typeValid === false
                  ? "Deterministic check failed"
                  : "Deterministic checks passed"
              }
              detail={
                checks.typeValid === false
                  ? "The proposed value does not fit the field schema. Reject it and request fresh extraction."
                  : checks.grounded === false
                    ? "The quote was not found word for word in the OCR text."
                    : "The recorded evidence and format checks passed."
              }
            />
          )}
          {semantic ? (
            <Gate
              state={
                semantic.value && semantic.confidence >= data.config.jev.thresholds.semanticCheck
                  ? "pass"
                  : "fail"
              }
              title={semantic.value ? "Semantic check" : "Semantic check did not confirm the value"}
            >
              <Scale p={semantic.confidence} t={data.config.jev.thresholds.semanticCheck} />
            </Gate>
          ) : (
            c.confidence !== null && (
              <Gate
                state={checks.candidatePassed === true ? "pass" : "skip"}
                title="Candidate confidence"
              >
                <Scale
                  p={c.confidence}
                  t={
                    c.field_name === "document_type"
                      ? data.config.jev.thresholds.documentType
                      : c.field_name === "correspondent"
                        ? data.config.jev.thresholds.correspondent
                        : c.field_name.startsWith("tag:")
                          ? data.config.jev.thresholds.tag
                          : data.config.jev.thresholds.customField
                  }
                  label="Candidate confidence"
                />
              </Gate>
            )
          )}
          {checks.humanConflict === true && (
            <Gate
              state="skip"
              title="Not saved automatically"
              detail="A value set by hand needs your approval before it changes."
            />
          )}
          {checks.dependencyBlocked === true && (
            <Gate
              state="skip"
              title="Waiting for dependent fields"
              detail="The document type and title inputs must be resolved before this field can be saved."
            />
          )}
          {c.status === "failed" && (
            <Gate
              state="fail"
              title="Remote write was not verified"
              detail="Inspect the current document in Paperless before requesting fresh processing."
            />
          )}
        </ul>
      </div>
      <Excerpt text={text} quote={c.evidence_quote} />
    </div>
  );
}
export function Slip({
  docId,
  data,
  error,
  result,
}: {
  docId: number;
  data: ReviewData;
  error?: string;
  result?: string;
}) {
  const changes = data.changes.filter((c) => c.doc_id === docId),
    held = changes.filter(pending);
  const doc = data.documents.get(docId),
    target = `#doc-${docId}`,
    url = `/review/documents/${docId}`;
  const applied = changes.filter((c) => c.status === "applied");
  const saved = applied.filter(
    (c, i) =>
      applied.findIndex((other) => other.field_name === c.field_name) === i &&
      (!doc ||
        equal(
          fieldValue(doc, c.field_name, parseJson(c.check_results_json, {})),
          parseJson(c.proposed_value_json, null),
        )),
  );
  const type = data.catalog?.document_types.find((e) => e.id === doc?.document_type);
  const correspondent = data.catalog?.correspondents.find((e) => e.id === doc?.correspondent);
  return (
    <article
      class="slip"
      id={`doc-${docId}`}
      aria-labelledby={`t-${docId}`}
      tabindex={result ? -1 : undefined}
    >
      <div class="slip-margin">
        <p class="docno">No. {docId}</p>
        {held.length > 0 && (
          <dl class="facts">
            <div>
              <dt>Document type</dt>
              <dd>
                {type?.name ?? (doc?.document_type ? `No. ${doc.document_type}` : "Not resolved")}
              </dd>
            </div>
            <div>
              <dt>Correspondent</dt>
              <dd>
                {correspondent?.name ??
                  (doc?.correspondent ? `No. ${doc.correspondent}` : "Not resolved")}
              </dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>
                {dateText(doc?.added)}
                {doc?.page_count ? `, ${doc.page_count} pages` : ""}
              </dd>
            </div>
          </dl>
        )}
      </div>
      <div class="slip-body">
        <header>
          <h3 class="slip-title" id={`t-${docId}`}>
            <a href={`${data.shell.externalUrl}/documents/${docId}/details`}>
              {doc?.title || `Document ${docId}`}
            </a>
          </h3>
          {held.length > 0 && (
            <p class="slip-sub">
              Held because{" "}
              {held.some(
                (c) => parseJson<Record<string, unknown>>(c.check_results_json, {}).humanConflict,
              )
                ? "a field conflicts with a value set outside this service."
                : held.some(
                      (c) =>
                        parseJson<Record<string, unknown>>(c.check_results_json, {})
                          .dependencyBlocked,
                    )
                  ? "a document type or another dependent field needs your decision."
                  : "a field did not pass every check."}
            </p>
          )}
        </header>
        {result && (
          <div class="decided">
            <Stamp text={result} rejected={result === "Rejected"} />
            <p class="decided-text">
              {held.length
                ? "Some fields remain held. Review their checks before approving again."
                : "No held fields remain in this document."}
            </p>
          </div>
        )}
        {held.length > 0 && (
          <form
            class="slip-form"
            method="post"
            action={`${url}/approve?all=1`}
            hx-target={target}
            hx-swap="outerHTML swap:120ms"
            hx-disabled-elt={`${target} button`}
            hx-indicator={target}
          >
            <div class="staged">
              {held.map((c) => (
                <Field key={c.id} change={c} data={data} multiple={held.length > 1} />
              ))}
            </div>
            {saved.length > 0 && (
              <details class="applied">
                <summary>
                  {saved.length} {saved.length === 1 ? "field" : "fields"} already saved in
                  Paperless
                </summary>
                <Ledger headings={["Field", "Value", "Confidence", "Checks"]}>
                  <tbody>
                    {saved.map((c) => (
                      <tr key={c.id}>
                        <td class="cell-main">{label(c)}</td>
                        <td data-label="Value">
                          {display(parseJson(c.proposed_value_json, null))}
                        </td>
                        <td data-label="Confidence">
                          {c.confidence?.toFixed(2) ?? "Not recorded"}
                        </td>
                        <td data-label="Checks">
                          <Mark kind="ok">Verified</Mark>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Ledger>
              </details>
            )}
            <div class="actions">
              <button
                class="btn btn-primary"
                type="submit"
                hx-post={`${url}/approve?all=1`}
                disabled={Boolean(data.shell.unavailable)}
              >
                {held.length > 1 ? "Approve all" : "Approve"}
              </button>
              {held.length > 1 && (
                <button
                  class="btn"
                  type="submit"
                  formaction={`${url}/approve`}
                  hx-post={`${url}/approve`}
                  disabled={Boolean(data.shell.unavailable)}
                >
                  Approve selected
                </button>
              )}
              <button
                class="btn btn-danger"
                type="submit"
                formaction={`${url}/reject`}
                hx-post={`${url}/reject`}
                disabled={Boolean(data.shell.unavailable)}
              >
                Reject
              </button>
              <span class="working">Writing to Paperless</span>
              <p class="actions-note">
                Approve writes eligible held values. Reject keeps existing values in Paperless.
                Unselected fields stay held.
              </p>
            </div>
          </form>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
    </article>
  );
}
export function Waiting({ data, oob = false }: { data: ReviewData; oob?: boolean }) {
  return (
    <div id="waiting" hx-swap-oob={oob ? "true" : undefined}>
      <Ledger headings={["Document", "Waits for", "Added"]}>
        <tbody>
          {[...waitingIds(data)].map((id) => (
            <tr key={id}>
              <td class="cell-main">
                <a href={`${data.shell.externalUrl}/documents/${id}/details`}>
                  {data.documents.get(id)?.title || `Document ${id}`}
                </a>
              </td>
              <td data-label="Waits for">
                {data.proposals
                  .filter((p) =>
                    data.changes.some(
                      (c) => c.doc_id === id && c.proposal_id === p.id && pending(c),
                    ),
                  )
                  .map((p, i) => (
                    <span key={p.id}>
                      {i ? ", " : ""}
                      <a href={`#name-${p.id}`}>{name(p)}</a>
                    </span>
                  ))}
              </td>
              <td data-label="Added">{dateText(data.documents.get(id)?.added)}</td>
            </tr>
          ))}
        </tbody>
      </Ledger>
    </div>
  );
}
export function Documents({ data, oob = false }: { data: ReviewData; oob?: boolean }) {
  const waiting = waitingIds(data),
    docs = [...new Set(data.changes.filter(pending).map((c) => Number(c.doc_id)))].filter(
      (id) => !waiting.has(id),
    );
  return (
    <div id="documents" hx-swap-oob={oob ? "true" : undefined}>
      {docs.length ? (
        docs.map((id) => <Slip key={id} docId={id} data={data} />)
      ) : (
        <Part id="nothing-held" title="Nothing is held for review.">
          <Empty title="Your review queue is clear.">
            Documents tagged <span class="tagname">{data.config.tags.requested}</span> appear here
            when a field or a name needs you.
          </Empty>
        </Part>
      )}
    </div>
  );
}
export function ReviewPage({
  data,
  openId,
  entities,
  query,
}: {
  data: ReviewData;
  openId?: string;
  entities?: Entity[];
  query?: string;
}) {
  return (
    <Layout
      shell={data.shell}
      title="Review queue"
      active="review"
      lede={`${data.shell.counts.review} ${data.shell.counts.review === 1 ? "document is" : "documents are"} held back. Decide new names first to release waiting documents, then check the fields below.`}
      summary={<ReviewSummary data={data} />}
    >
      {data.proposals.length > 0 && (
        <Part
          id="names"
          title="New names"
          note="A name that is not in your Paperless catalog yet. Decide it once for every document that uses it."
        >
          <ul id="names">
            {data.proposals.map((p) => (
              <Proposal
                key={p.id}
                proposal={p}
                data={data}
                open={p.id === openId}
                entities={p.id === openId ? entities : []}
                query={query}
              />
            ))}
          </ul>
        </Part>
      )}
      <Part id="docs" title="Documents" lead>
        <p>
          {data.config.stagingMode === "dependency_aware"
            ? "Independent fields that passed every check are already saved in Paperless."
            : "Document staging holds all proposed fields until their dependencies are resolved."}{" "}
          Below is what was held back, with the passage it was read from.
        </p>
      </Part>
      <Documents data={data} />
      {waitingIds(data).size > 0 ? (
        <Part
          id="waiting-names"
          title="Waiting on a name"
          note="These documents join the list above once their names are decided."
        >
          <Waiting data={data} />
        </Part>
      ) : (
        <div id="waiting" />
      )}
    </Layout>
  );
}
