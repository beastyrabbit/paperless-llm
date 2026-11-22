import type { Child } from "hono/jsx";
import { groundedRange } from "../../pipeline/gate.js";

export function Part({
  id,
  title,
  note,
  wide,
  lead,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  wide?: boolean;
  lead?: boolean;
  children?: Child;
}) {
  return (
    <section
      class={`part${wide ? " part-wide" : ""}${lead ? " part-lead" : ""}`}
      aria-labelledby={`h-${id}`}
    >
      <div class="part-margin">
        <h2 id={`h-${id}`}>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}
export function Scale({
  p = 0,
  t = 0,
  plain = false,
  zone = false,
  label = "Jev probability",
  read,
}: {
  p?: number;
  t?: number;
  plain?: boolean;
  zone?: boolean;
  label?: string;
  read?: Child;
}) {
  const value = Math.max(0, Math.min(1, p)),
    threshold = Math.max(0, Math.min(1, t));
  return (
    <div
      class={`scale${plain ? " scale-neutral scale-plain" : zone ? " scale-zone" : value < threshold ? " scale-under" : ""}`}
      style={`--p:${value}; --t:${threshold}`}
      role="img"
      aria-label={`${label} ${value.toFixed(2)}, threshold ${threshold.toFixed(2)}`}
    >
      <span class="scale-bar" />
      <span class="scale-read">
        {read ?? (
          <>
            <b>{value.toFixed(2)}</b>, needs {threshold.toFixed(2)}
          </>
        )}
      </span>
    </div>
  );
}
export function Gate({
  state,
  title,
  detail,
  children,
}: {
  state: "pass" | "fail" | "skip";
  title: string;
  detail?: string;
  children?: Child;
}) {
  return (
    <li class={`gate gate-${state}`}>
      <div>
        <b>{title}</b>
        {detail && <span>{detail}</span>}
        {children}
      </div>
    </li>
  );
}
// OCR and quotes are always escaped JSX text, never interpreted as HTML.
export function Excerpt({
  text,
  quote,
  lang = "de",
}: {
  text: string;
  quote: string | null;
  lang?: string;
}) {
  const range = quote ? groundedRange(text, quote) : null;
  const index = range?.start ?? -1;
  const start = index < 0 ? 0 : Math.max(0, text.lastIndexOf("\n", Math.max(0, index - 250)) + 1);
  const end =
    index < 0 ? Math.min(text.length, 700) : Math.min(text.length, (range?.end ?? index) + 250);
  const line = text.slice(0, start).split("\n").length;
  return (
    <figure class="excerpt">
      <blockquote lang={lang}>
        {index < 0
          ? text.slice(start, end) || "No OCR text saved locally."
          : [
              text.slice(start, index),
              <mark>{text.slice(index, range?.end)}</mark>,
              text.slice(range?.end, end),
            ]}
      </blockquote>
      <figcaption>
        OCR text, lines {line} to {line + text.slice(start, end).split("\n").length - 1}
        {quote && index < 0 ? (
          <>
            . Quote not found word for word. Proposed quote: <q>{quote}</q>
          </>
        ) : (
          ""
        )}
      </figcaption>
    </figure>
  );
}
export function Mark({
  kind,
  children,
}: {
  kind: "ok" | "fail" | "unsure" | "held" | "none";
  children: Child;
}) {
  return (
    <>
      <span class={`mark mark-${kind}`} aria-hidden="true" />
      {children}
    </>
  );
}
export function Stamp({
  text,
  date,
  rejected,
}: {
  text: string;
  date?: string | null;
  rejected?: boolean;
}) {
  return (
    <p class={`stamp${rejected ? " stamp-red" : ""}`}>
      {text}
      {date && <small>{dateText(date)}</small>}
    </p>
  );
}
export function Alert({
  title = "Action not completed",
  children,
  page = false,
}: {
  title?: string;
  children: Child;
  page?: boolean;
}) {
  return (
    <div class={`alert alert-error ${page ? "alert-page" : "row-wide"}`} role="alert">
      <b>{title}</b>
      <p>{children}</p>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: Child }) {
  return (
    <div class="empty">
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Ledger({
  id,
  headings,
  children,
  caption,
}: {
  id?: string;
  headings: string[];
  children: Child;
  caption?: string;
}) {
  return (
    <table class="ledger ledger-stack" id={id}>
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          {headings.map((h) => (
            <th scope="col" key={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      {children}
    </table>
  );
}
export function dateText(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      }).format(date);
}
export function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "No value";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
