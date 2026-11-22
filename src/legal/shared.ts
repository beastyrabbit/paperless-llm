export type LegalLocale = "de" | "en";

export const operator = {
  name: "Tobias Heer",
  careOf: "c/o Impressumservice Dein-Impressum",
  street: "Stettiner Str. 41",
  city: "35410 Hungen",
  country: { de: "Deutschland", en: "Germany" },
  noticeEmail: "impressum-paperless-llm@heerlab.com",
  privacyEmail: "datenschutz-paperless-llm@heerlab.com",
  contactForm: "https://beastyrabbit.com/kontakt?from=paperless-llm",
} as const;

export const site = {
  name: "Paperless Local LLM",
  url: "https://paperless-llm.heerlab.com",
  updated: { de: "21.10.2026", en: "21 October 2026" },
} as const;

export const legalPaths = {
  de: { notice: "/impressum", privacy: "/datenschutz" },
  en: { notice: "/legal-notice", privacy: "/privacy" },
} as const;

export type LegalInline = string | { text: string; href: string } | { strong: string };

export type LegalBlock =
  | { type: "paragraph"; content: readonly LegalInline[] }
  | { type: "list"; items: readonly (readonly LegalInline[])[] }
  | { type: "operator" }
  | { type: "table"; headers: readonly string[]; rows: readonly (readonly string[])[] };

export interface LegalSection {
  id: string;
  heading: string;
  body: readonly LegalBlock[];
}

export interface LegalDocument {
  title: string;
  updated?: string;
  sections: readonly LegalSection[];
}
