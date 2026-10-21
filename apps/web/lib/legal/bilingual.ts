import type { LegalBlock, LegalDocument, LegalInline, LegalLocale } from "./shared";

type LocalizedText = Record<LegalLocale, string>;

type BilingualInline =
  | LocalizedText
  | { text: LocalizedText; href: string | LocalizedText }
  | { strong: LocalizedText };

type BilingualBlock =
  | { type: "paragraph"; content: readonly BilingualInline[] }
  | { type: "list"; items: readonly (readonly BilingualInline[])[] }
  | { type: "operator" }
  | {
      type: "table";
      headers: readonly LocalizedText[];
      rows: readonly (readonly LocalizedText[])[];
    };

export interface BilingualDocument {
  title: LocalizedText;
  updated?: LocalizedText;
  sections: readonly {
    id: string;
    heading: LocalizedText;
    body: readonly BilingualBlock[];
  }[];
}

export function text(de: string, en = de): LocalizedText {
  return { de, en };
}

export function paragraph(...content: BilingualInline[]): BilingualBlock {
  return { type: "paragraph", content };
}

function resolveInline(part: BilingualInline, locale: LegalLocale): LegalInline {
  if ("de" in part) return part[locale];
  if ("strong" in part) return { strong: part.strong[locale] };
  const href = typeof part.href === "string" ? part.href : part.href[locale];
  return { text: part.text[locale], href };
}

function resolveBlock(block: BilingualBlock, locale: LegalLocale): LegalBlock {
  switch (block.type) {
    case "paragraph":
      return {
        type: block.type,
        content: block.content.map((part) => resolveInline(part, locale)),
      };
    case "list":
      return {
        type: block.type,
        items: block.items.map((item) => item.map((part) => resolveInline(part, locale))),
      };
    case "operator":
      return block;
    case "table":
      return {
        type: block.type,
        headers: block.headers.map((header) => header[locale]),
        rows: block.rows.map((row) => row.map((cell) => cell[locale])),
      };
  }
}

function resolveDocument(document: BilingualDocument, locale: LegalLocale): LegalDocument {
  return {
    title: document.title[locale],
    ...(document.updated ? { updated: document.updated[locale] } : {}),
    sections: document.sections.map((section) => ({
      id: section.id,
      heading: section.heading[locale],
      body: section.body.map((block) => resolveBlock(block, locale)),
    })),
  };
}

export function resolveDocuments(document: BilingualDocument): Record<LegalLocale, LegalDocument> {
  return {
    de: resolveDocument(document, "de"),
    en: resolveDocument(document, "en"),
  };
}
