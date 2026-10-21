import { type LegalDocument, type LegalLocale, operator, site } from "./shared";

export const noticeDocuments: Record<LegalLocale, LegalDocument> = {
  de: {
    title: "Impressum",
    sections: [
      {
        id: "provider",
        heading: "Anbieter",
        body: [
          {
            type: "operator",
          },
        ],
      },
      {
        id: "contact",
        heading: "Kontakt",
        body: [
          {
            type: "paragraph",
            content: [
              "E-Mail: ",
              {
                text: operator.noticeEmail,
                href: `mailto:${operator.noticeEmail}`,
              },
              "\nKontaktformular: ",
              {
                text: "beastyrabbit.com/kontakt",
                href: operator.contactForm,
              },
            ],
          },
        ],
      },
      {
        id: "note",
        heading: "Hinweis",
        body: [
          {
            type: "paragraph",
            content: [`${site.name} ist ein privates, nicht-kommerzielles Projekt.`],
          },
        ],
      },
      {
        id: "privacy",
        heading: "Datenschutz",
        body: [
          {
            type: "paragraph",
            content: [
              "Informationen zur Verarbeitung personenbezogener Daten finden Sie in der ",
              {
                text: "Datenschutzerklärung",
                href: "/datenschutz",
              },
              ".",
            ],
          },
        ],
      },
    ],
  },
  en: {
    title: "Legal Notice (Impressum)",
    sections: [
      {
        id: "provider",
        heading: "Provider",
        body: [
          {
            type: "operator",
          },
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        body: [
          {
            type: "paragraph",
            content: [
              "E-mail: ",
              {
                text: operator.noticeEmail,
                href: `mailto:${operator.noticeEmail}`,
              },
              "\nContact form: ",
              {
                text: "beastyrabbit.com/kontakt",
                href: operator.contactForm,
              },
            ],
          },
        ],
      },
      {
        id: "note",
        heading: "Note",
        body: [
          {
            type: "paragraph",
            content: [`${site.name} is a private, non-commercial project.`],
          },
        ],
      },
      {
        id: "privacy",
        heading: "Privacy",
        body: [
          {
            type: "paragraph",
            content: [
              "For information on how personal data is processed, see the ",
              {
                text: "Privacy Policy",
                href: "/privacy",
              },
              ".",
            ],
          },
        ],
      },
    ],
  },
};
