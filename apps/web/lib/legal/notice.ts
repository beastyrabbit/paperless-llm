import { type BilingualDocument, paragraph, resolveDocuments, text } from "./bilingual";
import { operator, site } from "./shared";

const noticeDocument: BilingualDocument = {
  title: text("Impressum", "Legal Notice (Impressum)"),
  sections: [
    { id: "provider", heading: text("Anbieter", "Provider"), body: [{ type: "operator" }] },
    {
      id: "contact",
      heading: text("Kontakt", "Contact"),
      body: [
        paragraph(
          text("E-Mail: ", "E-mail: "),
          { text: text(operator.noticeEmail), href: `mailto:${operator.noticeEmail}` },
          text("\nKontaktformular: ", "\nContact form: "),
          { text: text("beastyrabbit.com/kontakt"), href: operator.contactForm },
        ),
      ],
    },
    {
      id: "note",
      heading: text("Hinweis", "Note"),
      body: [
        paragraph(
          text(
            `${site.name} ist ein privates, nicht-kommerzielles Projekt.`,
            `${site.name} is a private, non-commercial project.`,
          ),
        ),
      ],
    },
    {
      id: "privacy",
      heading: text("Datenschutz", "Privacy"),
      body: [
        paragraph(
          text(
            "Informationen zur Verarbeitung personenbezogener Daten finden Sie in der ",
            "For information on how personal data is processed, see the ",
          ),
          {
            text: text("Datenschutzerklärung", "Privacy Policy"),
            href: text("/datenschutz", "/privacy"),
          },
          text("."),
        ),
      ],
    },
  ],
};

export const noticeDocuments = resolveDocuments(noticeDocument);
