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
        "Sicherungskopien werden innerhalb der eigenen Infrastruktur gespeichert und nach spätestens drei Monaten überschrieben.",
      ssoBackupRetention: "Sicherungskopien werden nach spätestens drei Monaten überschrieben.",
      numberedReference: /Abschnitt\s+\d/i,
    },
    {
      lang: "en",
      get: getPrivacyEn,
      retention: "Log files are deleted automatically after 14 days.",
      backupRetention:
        "Backup copies are stored within the controller's own infrastructure and overwritten after at most three months.",
      ssoBackupRetention: "Backup copies are overwritten after at most three months.",
      // Section 25(2) TDDDG is a statutory citation, not a reference to a page section.
      numberedReference: /\bsection\s+\d+\b(?!\()/i,
    },
  ])("$lang privacy keeps verified retention and heading-based cross-references", async ({
    get,
    retention,
    backupRetention,
    ssoBackupRetention,
    numberedReference,
  }) => {
    const html = await get().text();

    expect(html).toContain(retention);
    expect(html).toContain(escapeHtml(backupRetention));
    expect(html).toContain(ssoBackupRetention);
    expect(html).not.toMatch(/Hetzner|ohne feste Löschfrist|fixed deletion period/i);
    expect(html).not.toMatch(numberedReference);
    expect(html).not.toContain("Hosting/Backups");
  });

  it.each([
    {
      lang: "de",
      get: getPrivacyDe,
      mistralTransfer:
        "Mistral AI hat seinen Sitz in der EU. Soweit Dienstleister von Mistral AI personenbezogene Daten außerhalb der EU verarbeiten, verwendet Mistral AI nach eigenen Angaben Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO).",
      signInCookie: [
        "p_session_token",
        "Pangolin, pangolin.heerlab.com",
        "Hält die Anmeldung beim Anmeldedienst Pangolin während der SSO-Anmeldung; HttpOnly, Secure, SameSite=Lax.",
        "30 Tage",
        "Für die Anmeldung erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
      ],
      resourceCookie: "p_session_token_s.<Zeitstempel>",
    },
    {
      lang: "en",
      get: getPrivacyEn,
      mistralTransfer:
        "Mistral AI is established in the EU. Where Mistral AI's service providers process personal data outside the EU, Mistral AI states that it uses the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR).",
      signInCookie: [
        "p_session_token",
        "Pangolin, pangolin.heerlab.com",
        "Keeps the sign-in at the Pangolin sign-in service during SSO; HttpOnly, Secure, SameSite=Lax.",
        "30 days",
        "Required for sign-in (Section 25(2) no. 2 TDDDG).",
      ],
      resourceCookie: "p_session_token_s.<timestamp>",
    },
  ])("$lang privacy documents Mistral transfer safeguards and both Pangolin cookies", async ({
    get,
    mistralTransfer,
    signInCookie,
    resourceCookie,
  }) => {
    const html = await get().text();

    expect(html).toContain(escapeHtml(mistralTransfer));
    expect(html).toContain(
      `<tr>${signInCookie.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    );
    expect(html).toContain(`<tr><td>${escapeHtml(resourceCookie)}</td>`);
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
