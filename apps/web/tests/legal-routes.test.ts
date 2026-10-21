// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { GET as getPrivacyDe } from "../app/datenschutz/route";
import { GET as getNoticeDe } from "../app/impressum/route";
import { GET as getNoticeEn } from "../app/legal-notice/route";
import { GET as getPrivacyEn } from "../app/privacy/route";
import { privacyDocuments } from "../lib/legal/privacy";
import { escapeHtml } from "../lib/legal/render";
import { operator } from "../lib/legal/shared";

describe("standalone legal routes", () => {
  it.each([
    {
      path: "/impressum",
      get: getNoticeDe,
      lang: "de",
      sibling: "/datenschutz",
      translation: "/legal-notice",
      sections: 4,
    },
    {
      path: "/datenschutz",
      get: getPrivacyDe,
      lang: "de",
      sibling: "/impressum",
      translation: "/privacy",
      sections: 13,
    },
    {
      path: "/legal-notice",
      get: getNoticeEn,
      lang: "en",
      sibling: "/privacy",
      translation: "/impressum",
      sections: 4,
    },
    {
      path: "/privacy",
      get: getPrivacyEn,
      lang: "en",
      sibling: "/legal-notice",
      translation: "/datenschutz",
      sections: 13,
    },
  ])("$path returns complete HTML without app assets or API calls", async ({
    get,
    lang,
    sibling,
    translation,
    sections,
  }) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const response = get();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(html).toContain(`<!doctype html>\n<html lang="${lang}">`);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<link rel="icon" href="data:,">');
    for (const value of [
      operator.name,
      operator.careOf,
      operator.street,
      operator.city,
      operator.noticeEmail,
      operator.privacyEmail,
      operator.contactForm,
    ]) {
      expect(html).toContain(value);
    }
    for (const href of ["/", sibling, translation]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).not.toMatch(/\[\[|<script|\/_next\/|<!--|TODO\(legal\)/i);
    expect(html).not.toMatch(/<(?:img|iframe|script)\b|<link[^>]+(?:stylesheet|preload)|url\s*\(/i);
    expect(html.match(/<section /g)).toHaveLength(sections);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      lang: "de",
      get: getPrivacyDe,
      retention: "Die Logfiles werden nach 14 Tagen automatisch gelöscht.",
      backupRetention:
        "Zur Datensicherung werden regelmäßig Sicherungskopien innerhalb der eigenen Infrastruktur erstellt; sie werden nach Ablauf ihrer Aufbewahrungszeit überschrieben.",
      documentRetention: "Diese Daten werden bis zu 10 Jahre aufbewahrt.",
      additionalLogRetention: "Diese Protokolle werden nach höchstens 90 Tagen gelöscht.",
      ssoDeletion:
        "Das Benutzerkonto in Pocket-ID und Pangolin besteht, solange der Zugang eingeräumt ist, und wird auf Anfrage oder nach Entzug des Zugangs gelöscht. Anmeldeprotokolle werden nach 90 Tagen gelöscht.",
      numberedReference: /Abschnitt\s+\d/i,
    },
    {
      lang: "en",
      get: getPrivacyEn,
      retention: "Log files are deleted automatically after 14 days.",
      backupRetention:
        "To protect against data loss, backup copies are regularly created within the controller's own infrastructure; they are overwritten once their retention period expires.",
      documentRetention: "This data is kept for up to 10 years.",
      additionalLogRetention: "These logs are deleted after no more than 90 days.",
      ssoDeletion:
        "The user account in Pocket-ID and Pangolin exists for as long as access is granted and is deleted on request or after access is withdrawn. Sign-in logs are deleted after 90 days.",
      // Section 25(2) TDDDG is a statutory citation, not a reference to a page section.
      numberedReference: /\bsection\s+\d+\b(?!\()/i,
    },
  ])("$lang privacy keeps verified retention and heading-based cross-references", async ({
    get,
    retention,
    backupRetention,
    documentRetention,
    additionalLogRetention,
    ssoDeletion,
    numberedReference,
  }) => {
    const html = await get().text();

    expect(html).toContain(retention);
    expect(html).toContain(escapeHtml(backupRetention));
    expect(html).toContain(documentRetention);
    expect(html).toContain(additionalLogRetention);
    expect(html).toContain(ssoDeletion);
    expect(html).not.toMatch(
      /Hetzner|ohne feste Löschfrist|automatic deletion period|fixed deletion period|tinybase|Qdrant|Longhorn/i,
    );
    expect(html).not.toMatch(numberedReference);
    expect(html).not.toContain("Hosting/Backups");
  });

  it.each([
    {
      lang: "de",
      get: getPrivacyDe,
      mistralProcessing:
        "Ist die Texterkennung (OCR) aktiviert, werden Dokumentinhalte zur Texterkennung an die Mistral AI SAS, 15 rue des Halles, 75001 Paris, Frankreich, übermittelt. Dies erfolgt im Rahmen der im Abschnitt „Verarbeitung von Dokumenten“ beschriebenen Verarbeitung. Für Speicherung und Verwendung der Daten durch Mistral AI gelten deren ",
      mistralTransfer:
        "Soweit Dienstleister von Mistral AI Daten außerhalb der EU verarbeiten, verwendet Mistral AI nach eigenen Angaben Standardvertragsklauseln der EU-Kommission.",
      mistralLinks: ["Datenschutzerklärung", "Bedingungen"],
      cookies:
        "Es werden nur technisch notwendige Cookies gesetzt (§ 25 Abs. 2 Nr. 2 TDDDG): nach der Anmeldung Sitzungs-Cookies des Anmeldedienstes Pangolin (gültig bis zu 30 Tage) und, wenn Sie die Sprache der Anwendung ändern, ein Cookie mit der gewählten Sprache (1 Jahr). Analyse- oder Werbe-Cookies werden nicht verwendet, und die Anwendung lädt keine Inhalte von Drittanbietern.",
    },
    {
      lang: "en",
      get: getPrivacyEn,
      mistralProcessing:
        'When text recognition (OCR) is enabled, document contents are sent to Mistral AI SAS, 15 rue des Halles, 75001 Paris, France, for text recognition. This is part of the processing described in the "Document processing" section. Mistral AI\'s storage and use of the data are governed by its ',
      mistralTransfer:
        "Where Mistral AI's service providers process data outside the EU, Mistral AI states that it uses the European Commission's Standard Contractual Clauses.",
      mistralLinks: ["privacy policy", "terms"],
      cookies:
        "Only technically necessary cookies are set (Section 25(2) no. 2 TDDDG): after sign-in, session cookies from the Pangolin sign-in service (valid for up to 30 days) and, if you change the application's language, a cookie storing your chosen language (1 year). No analytics or advertising cookies are used, and the application loads no third-party content.",
    },
  ])("$lang privacy describes optional OCR and necessary cookies in general terms", async ({
    get,
    mistralProcessing,
    mistralTransfer,
    mistralLinks,
    cookies,
  }) => {
    const html = await get().text();

    expect(html).toContain(escapeHtml(mistralProcessing));
    expect(html).toContain(escapeHtml(mistralTransfer));
    expect(html).toContain(
      `<a href="https://legal.mistral.ai/terms/privacy-policy">${mistralLinks[0]}</a>`,
    );
    expect(html).toContain(
      `<a href="https://legal.mistral.ai/terms/commercial-terms-of-service">${mistralLinks[1]}</a>`,
    );
    expect(html).toContain(escapeHtml(cookies));
    expect(html).not.toMatch(
      /<table|p_session_token|NEXT_LOCALE|data-processing-addendum|OCR ist derzeit aktiviert|OCR is currently enabled|vollständige Dokumentdatei|complete document file/i,
    );
  });

  it("keeps German and English privacy sections in the same order", () => {
    expect(privacyDocuments.de.sections.map(({ id }) => id)).toEqual(
      privacyDocuments.en.sections.map(({ id }) => id),
    );
    expect(privacyDocuments.de.sections).toHaveLength(13);
  });

  it("escapes HTML text and attribute delimiters", () => {
    expect(escapeHtml("<script a=\"x\" b='y'>&")).toBe(
      "&lt;script a=&quot;x&quot; b=&#39;y&#39;&gt;&amp;",
    );
  });
});
