import { noticeDocuments } from "./notice";
import { privacyDocuments } from "./privacy";
import {
  type LegalBlock,
  type LegalInline,
  type LegalLocale,
  type LegalSection,
  legalPaths,
  operator,
  site,
} from "./shared";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function link(text: string, href: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

function renderInline(content: readonly LegalInline[]): string {
  return content
    .map((part) => {
      if (typeof part === "string") return escapeHtml(part);
      if ("strong" in part) return `<strong>${escapeHtml(part.strong)}</strong>`;
      return link(part.text, part.href);
    })
    .join("");
}

function renderListItem(content: readonly LegalInline[]): string {
  return `<li>${renderInline(content)}</li>`;
}

function renderTableHeader(header: string): string {
  return `<th scope="col">${escapeHtml(header)}</th>`;
}

function renderTableCell(cell: string): string {
  return `<td>${escapeHtml(cell)}</td>`;
}

function renderTableRow(row: readonly string[]): string {
  return `<tr>${row.map(renderTableCell).join("")}</tr>`;
}

function renderBlock(block: LegalBlock, locale: LegalLocale): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${renderInline(block.content)}</p>`;
    case "list":
      return `<ul>${block.items.map(renderListItem).join("")}</ul>`;
    case "operator":
      return `<address>${[
        operator.name,
        operator.careOf,
        operator.street,
        operator.city,
        operator.country[locale],
      ]
        .map(escapeHtml)
        .join("<br>")}</address>`;
    case "table":
      return `<div class="table-scroll" role="region" aria-label="Cookies" tabindex="0"><table><thead><tr>${block.headers.map(renderTableHeader).join("")}</tr></thead><tbody>${block.rows.map(renderTableRow).join("")}</tbody></table></div>`;
  }
}

function renderSection(
  section: LegalSection,
  index: number,
  locale: LegalLocale,
  numbered: boolean,
): string {
  const prefix = numbered ? `${index + 1}. ` : "";
  const body = section.body.map((block) => renderBlock(block, locale)).join("");
  return `<section id="${escapeHtml(section.id)}" aria-labelledby="heading-${escapeHtml(section.id)}"><h2 id="heading-${escapeHtml(section.id)}">${prefix}${escapeHtml(section.heading)}</h2>${body}</section>`;
}

function renderUpdated(updated: string | undefined, locale: LegalLocale): string {
  if (!updated) return "";
  const label = locale === "de" ? "Stand" : "Last updated";
  return `<p class="updated">${label}: ${escapeHtml(updated)}</p>`;
}

function emailLink(email: string): string {
  return link(email, `mailto:${email}`);
}

// Values and system-font stack from app/globals.css. No asset URLs or font downloads.
const styles = `
:root { color-scheme: dark; background: oklch(0.147 0.004 49.25); color: oklch(0.985 0.001 106.423); font-family: "Space Grotesk", "Segoe UI", "Inter", system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; line-height: 1.75; }
main, footer { width: min(100% - 2rem, 52rem); margin-inline: auto; }
main { padding-block: 2rem; }
nav { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; }
a { color: #10b981; text-underline-offset: .2em; overflow-wrap: anywhere; }
a:hover { color: #6ee7b7; }
a:focus-visible, .table-scroll:focus-visible { outline: 2px solid #10b981; outline-offset: 4px; }
h1, h2 { line-height: 1.25; overflow-wrap: anywhere; }
h1 { font-size: clamp(2rem, 6vw, 2.75rem); margin-top: 2rem; }
h2 { font-size: 1.35rem; }
section { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #27272a; }
p, li, td, address { overflow-wrap: anywhere; }
p { white-space: pre-line; }
address { font-style: normal; }
ul { padding-left: 1.4rem; }
.updated, footer { color: #a1a1aa; }
footer { border-top: 1px solid #27272a; padding-block: 1.5rem 2rem; }
footer p { margin-block: .75rem; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { min-width: 9rem; border: 1px solid #27272a; padding: .65rem; text-align: left; vertical-align: top; }
@media (max-width: 480px) { main { padding-top: 1rem; } h1 { font-size: 1.75rem; } h2 { font-size: 1.2rem; } }
`;

export function legalResponse(locale: LegalLocale, kind: "notice" | "privacy"): Response {
  const document = (kind === "notice" ? noticeDocuments : privacyDocuments)[locale];
  const otherLocale = locale === "de" ? "en" : "de";
  const siblingKind = kind === "notice" ? "privacy" : "notice";
  const labels = {
    de: {
      notice: "Impressum",
      privacy: "Datenschutz",
      back: "Zur Anwendung",
      contact: "Kontaktformular",
    },
    en: {
      notice: "Legal notice",
      privacy: "Privacy",
      back: "Back to the app",
      contact: "Contact form",
    },
  }[locale];
  const navigation = `<nav aria-label="${locale === "de" ? "Rechtliche Informationen" : "Legal information"}">${link(labels.back, "/")}${link(labels[siblingKind], legalPaths[locale][siblingKind])}<a href="${legalPaths[otherLocale][kind]}" lang="${otherLocale}" hreflang="${otherLocale}">${otherLocale === "de" ? "Deutsch" : "English"}</a></nav>`;
  const updated = renderUpdated(document.updated, locale);
  const sections = document.sections
    .map((section, index) => renderSection(section, index, locale, kind === "privacy"))
    .join("");
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(document.title)} | ${escapeHtml(site.name)}</title><link rel="icon" href="data:,"><style>${styles}</style></head>
<body><main>${navigation}<h1>${escapeHtml(document.title)}</h1>${updated}${sections}</main><footer>${navigation}<p>${emailLink(operator.noticeEmail)}<br>${emailLink(operator.privacyEmail)}<br>${link(labels.contact, operator.contactForm)}</p></footer></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
