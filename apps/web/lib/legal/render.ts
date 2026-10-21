import { noticeDocuments } from "./notice";
import { privacyDocuments } from "./privacy";
import {
  type LegalBlock,
  type LegalInline,
  type LegalLocale,
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

function renderBlock(block: LegalBlock, locale: LegalLocale): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${renderInline(block.content)}</p>`;
    case "list":
      return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
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
      return `<div class="table-scroll" role="region" aria-label="Cookies" tabindex="0"><table><thead><tr>${block.headers
        .map((header) => `<th scope="col">${escapeHtml(header)}</th>`)
        .join("")}</tr></thead><tbody>${block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
  }
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
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(document.title)} | ${escapeHtml(site.name)}</title><link rel="icon" href="data:,"><style>${styles}</style></head>
<body><main>${navigation}<h1>${escapeHtml(document.title)}</h1>${document.updated ? `<p class="updated">${locale === "de" ? "Stand" : "Last updated"}: ${escapeHtml(document.updated)}</p>` : ""}${document.sections
    .map(
      (section, index) =>
        `<section id="${escapeHtml(section.id)}" aria-labelledby="heading-${escapeHtml(section.id)}"><h2 id="heading-${escapeHtml(section.id)}">${kind === "privacy" ? `${index + 1}. ` : ""}${escapeHtml(section.heading)}</h2>${section.body.map((block) => renderBlock(block, locale)).join("")}</section>`,
    )
    .join(
      "",
    )}</main><footer>${navigation}<p>${link(operator.noticeEmail, `mailto:${operator.noticeEmail}`)}<br>${link(operator.privacyEmail, `mailto:${operator.privacyEmail}`)}<br>${link(labels.contact, operator.contactForm)}</p></footer></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
