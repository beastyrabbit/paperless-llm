import { type BilingualDocument, paragraph, resolveDocuments, text } from "./bilingual";
import { operator, site } from "./shared";

const privacyDocument: BilingualDocument = {
  title: text("Datenschutzerklärung", "Privacy Policy"),
  updated: site.updated,
  sections: [
    {
      id: "controller",
      heading: text("Verantwortlicher", "Controller"),
      body: [
        paragraph(
          text(
            `Verantwortlich für die Verarbeitung personenbezogener Daten auf ${site.url} ist:`,
            `The controller responsible for processing personal data on ${site.url} is:`,
          ),
        ),
        { type: "operator" },
        paragraph(text("E-Mail: ", "E-mail: "), {
          text: text(operator.privacyEmail),
          href: `mailto:${operator.privacyEmail}`,
        }),
        paragraph(
          text(
            "Ein Datenschutzbeauftragter ist nicht bestellt, da hierzu keine gesetzliche Pflicht besteht.",
            "No data protection officer has been appointed, as there is no legal obligation to do so.",
          ),
        ),
      ],
    },
    {
      id: "overview",
      heading: text("Überblick", "Overview"),
      body: [
        paragraph(
          text(
            `Diese Erklärung informiert darüber, welche personenbezogenen Daten bei der Nutzung von ${site.name} verarbeitet werden, zu welchen Zwecken, auf welcher Rechtsgrundlage und wie lange. ${site.name} ist ein privates, nicht-kommerzielles Projekt. Als internes Werkzeug analysiert es die eigenen Dokumente des Verantwortlichen aus seinem selbst betriebenen Paperless-ngx mit Sprachmodellen, schlägt Metadaten wie Titel, Korrespondent, Dokumenttyp, Tags und benutzerdefinierte Felder vor oder wendet sie an und bietet optional Texterkennung (OCR).`,
            `This policy explains which personal data is processed when you use ${site.name}, for what purposes, on which legal basis, and for how long. ${site.name} is a private, non-commercial project. As an internal tool, it uses language models to analyse the controller's own documents from his self-hosted Paperless-ngx, suggests or applies metadata such as title, correspondent, document type, tags and custom fields, and offers optional text recognition (OCR).`,
          ),
        ),
        paragraph(
          text(
            "Personenbezogene Daten werden nicht verkauft und nicht für Werbung verwendet. Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO findet nicht statt.",
            "Personal data is not sold and not used for advertising. There is no automated decision-making, including profiling, within the meaning of Art. 22 GDPR.",
          ),
        ),
      ],
    },
    {
      id: "hosting",
      heading: text("Hosting und Bereitstellung", "Hosting and delivery"),
      body: [
        paragraph(
          text(
            `${site.name} läuft auf eigener Server-Infrastruktur des Verantwortlichen in Deutschland. Aufrufe aus dem Internet erreichen die Anwendung über einen Reverse-Proxy auf einem virtuellen Server der netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Deutschland (Rechenzentrum in Nürnberg). netcup verarbeitet die Daten dabei als Auftragsverarbeiter; mit netcup besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. Die Verbindung ist bis zum Reverse-Proxy TLS-verschlüsselt und wird von dort durch einen verschlüsselten Tunnel an die eigene Infrastruktur weitergeleitet.`,
            `${site.name} runs on the controller's own server infrastructure in Germany. Requests from the internet reach the application through a reverse proxy on a virtual server operated by netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Germany (data center in Nuremberg). netcup processes the data as a processor under a data processing agreement pursuant to Art. 28 GDPR. The connection is TLS-encrypted up to the reverse proxy and forwarded from there to the controller's infrastructure through an encrypted tunnel.`,
          ),
        ),
        paragraph(
          text(
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in einer sicheren und zuverlässigen Bereitstellung der Website.",
            "The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the secure and reliable provision of the website.",
          ),
        ),
        paragraph(
          text(
            "Zur Datensicherung werden regelmäßig Sicherungskopien innerhalb der eigenen Infrastruktur erstellt; sie werden nach Ablauf ihrer Aufbewahrungszeit überschrieben.",
            "To protect against data loss, backup copies are regularly created within the controller's own infrastructure; they are overwritten once their retention period expires.",
          ),
        ),
      ],
    },
    {
      id: "logs",
      heading: text("Server-Logfiles", "Server log files"),
      body: [
        paragraph(
          text(
            "Bei jedem Aufruf speichert der Reverse-Proxy automatisch folgende Daten:",
            "For every request, the reverse proxy automatically stores the following data:",
          ),
        ),
        {
          type: "list",
          items: [
            [text("IP-Adresse des anfragenden Geräts", "IP address of the requesting device")],
            [text("Datum und Uhrzeit des Zugriffs", "date and time of access")],
            [
              text(
                "aufgerufene Adresse (Pfad einschließlich Parameter), HTTP-Methode und Protokoll",
                "requested address (path including parameters), HTTP method and protocol",
              ),
            ],
            [
              text(
                "HTTP-Statuscode, übertragene Datenmenge und Antwortzeit",
                "HTTP status code, amount of data transferred, and response time",
              ),
            ],
            [text("Browser-Kennung (User-Agent)", "browser identifier (user agent)")],
            [text("verwendete TLS-Version und Verschlüsselung", "TLS version and cipher used")],
            [text("angesprochener Dienst", "target service")],
          ],
        },
        paragraph(
          text(
            "Die Header Cookie und Authorization werden geschwärzt. URL-Pfade und Abfrageparameter werden protokolliert.",
            "The Cookie and Authorization headers are redacted. URL paths and query parameters are logged.",
          ),
        ),
        paragraph(
          text(
            "Die Daten dienen dem Betrieb, der Fehleranalyse und der Abwehr von Angriffen und Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in Stabilität und Sicherheit des Angebots. Die Logfiles werden nach 14 Tagen automatisch gelöscht.",
            "This data is used to operate the site, analyse errors, and defend against attacks and abuse. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the stability and security of the service. Log files are deleted automatically after 14 days.",
          ),
        ),
        paragraph(
          text(
            "Darüber hinaus protokollieren der Reverse-Proxy, der Anmeldedienst und die Anwendung selbst Zugriffe, Anmeldungen und Fehler (zum Beispiel IP-Adresse, Zeitpunkt, aufgerufene Adresse, Benutzerkennung und Browser-Kennung). Zweck sind Betrieb, Fehleranalyse und Sicherheit; Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Diese Protokolle werden nach höchstens 90 Tagen gelöscht.",
            "The reverse proxy, the sign-in service and the application itself also log access, sign-ins and errors (for example IP address, time, requested address, user identifier and browser identifier). The purposes are operation, error analysis and security; the legal basis is Art. 6(1)(f) GDPR. These logs are deleted after no more than 90 days.",
          ),
        ),
      ],
    },
    {
      id: "crowdsec",
      heading: text("Schutz vor Angriffen (CrowdSec)", "Protection against attacks (CrowdSec)"),
      body: [
        paragraph(
          text(
            "Zum Schutz vor Angriffen wertet die Sicherheitssoftware CrowdSec die Server-Logfiles automatisch aus und sperrt IP-Adressen, von denen erkennbar Angriffe ausgehen (zum Beispiel massenhafte Anmeldeversuche oder das Ausspähen von Schwachstellen). Erkennt CrowdSec einen Angriff, werden die IP-Adresse, der Zeitpunkt und die Art des Angriffs an die CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, Frankreich, übermittelt. CrowdSec nutzt diese Meldungen für eine gemeinsame Sperrliste, die Angriffe auf viele Server abwehrt. Bei normalem Surfen werden keine Daten an CrowdSec übermittelt.",
            "To protect against attacks, the security software CrowdSec automatically analyses the server log files and blocks IP addresses that are clearly the source of attacks (for example mass login attempts or scanning for vulnerabilities). When CrowdSec detects an attack, the IP address, time and type of attack are sent to CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, France. CrowdSec uses these reports for a shared blocklist that protects many servers. No data is sent to CrowdSec during normal browsing.",
          ),
        ),
        paragraph(
          text(
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt im Schutz der Website und ihrer Nutzer vor Angriffen.",
            "The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is protecting the website and its users from attacks.",
          ),
        ),
        paragraph(
          text(
            "Für diese Verarbeitung sind der Verantwortliche und CrowdSec nach Angaben von CrowdSec gemeinsam verantwortlich (Art. 26 DSGVO): CrowdSec ist für den Betrieb seiner zentralen Dienste und Sperrlisten verantwortlich, der Verantwortliche für den Einsatz auf diesem Server. Sie können Ihre Rechte gegenüber beiden geltend machen, bei CrowdSec unter ",
            "According to CrowdSec, the controller and CrowdSec are jointly responsible for this processing (Art. 26 GDPR): CrowdSec is responsible for operating its central services and blocklists, the controller for its use on this server. You can exercise your rights against either of them; CrowdSec can be reached at ",
          ),
          { text: text("dpo@crowdsec.net"), href: "mailto:dpo@crowdsec.net" },
          text(
            ". CrowdSec kann die gemeldeten Daten an Mitglieder und Partner seines Netzwerks weitergeben. Übermittlungen in Länder außerhalb der EU erfolgen nach Angaben von CrowdSec auf Grundlage von Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO).",
            ". CrowdSec may pass the reported data on to members and partners of its network. According to CrowdSec, transfers to countries outside the EU are based on the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR).",
          ),
        ),
        paragraph(
          text(
            "Vollständige IP-Adressen werden grundsätzlich höchstens drei Monate gespeichert und anschließend schrittweise verallgemeinert. Für bestimmte Angriffsanalysen und Trainingszwecke nennt CrowdSec Ausnahmen von bis zu einem Jahr vor der Anonymisierung. Details: ",
            "Full IP addresses are generally retained for no more than three months and then progressively generalised. CrowdSec describes exceptions of up to one year before anonymisation for certain attack analyses and training purposes. Details: ",
          ),
          {
            text: text("crowdsec.net/privacy-policy"),
            href: "https://www.crowdsec.net/privacy-policy",
          },
          text("."),
        ),
      ],
    },
    {
      id: "sso",
      heading: text("Anmeldung (Single Sign-On)", "Sign-in (single sign-on)"),
      body: [
        paragraph(
          text(
            `${site.name} ist nur für eingeladene Personen zugänglich. Die Anmeldung erfolgt über den Reverse-Proxy Pangolin mit dem selbst betriebenen Identitätsdienst Pocket-ID auf der eigenen Infrastruktur. Dabei werden Benutzername, E-Mail-Adresse, Gruppenzugehörigkeit, Zeitpunkt der Anmeldung und IP-Adresse verarbeitet. Nach der Anmeldung setzt Pangolin ein Sitzungs-Cookie, das für den Zugang technisch erforderlich ist.`,
            `${site.name} is only accessible to invited people. Sign-in is handled by the Pangolin reverse proxy with Pocket-ID, an identity service self-hosted on the controller's infrastructure. This processes your user name, e-mail address, group membership, time of sign-in and IP address. After sign-in, Pangolin sets a session cookie that is technically required for access.`,
          ),
        ),
        paragraph(
          text(
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, den Zugang auf berechtigte Personen zu beschränken. Das Benutzerkonto in Pocket-ID und Pangolin besteht, solange der Zugang eingeräumt ist, und wird auf Anfrage oder nach Entzug des Zugangs gelöscht. Anmeldeprotokolle werden nach 90 Tagen gelöscht.",
            "The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is restricting access to authorised people. The user account in Pocket-ID and Pangolin exists for as long as access is granted and is deleted on request or after access is withdrawn. Sign-in logs are deleted after 90 days.",
          ),
        ),
        paragraph(
          text(
            "Die rechtlichen Informationsseiten sind ohne Anmeldung zugänglich.",
            "The legal information pages are accessible without signing in.",
          ),
        ),
      ],
    },
    {
      id: "documents",
      heading: text("Verarbeitung von Dokumenten", "Document processing"),
      body: [
        paragraph(
          text(
            "Die Dokumente stammen aus dem selbst betriebenen Paperless-ngx des Verantwortlichen. Es handelt sich um seine persönlichen Unterlagen, die auch personenbezogene Daten Dritter enthalten können. Sie werden mit Sprachmodellen auf der eigenen Infrastruktur analysiert, um Metadaten (Titel, Korrespondent, Dokumenttyp, Tags) vorzuschlagen. Die Ergebnisse werden in Paperless-ngx zurückgeschrieben. Die Verarbeitung dient ausschließlich persönlichen oder familiären Zwecken des Verantwortlichen (Art. 2 Abs. 2 lit. c DSGVO).",
            "The documents come from the controller's self-hosted Paperless-ngx. They are his personal papers and may also contain personal data of third parties. They are analysed with language models on the controller's own infrastructure to suggest metadata (title, correspondent, document type, tags). The results are written back to Paperless-ngx. The processing serves exclusively the controller's personal or household purposes (Art. 2(2)(c) GDPR).",
          ),
        ),
        paragraph(
          text(
            "Die Anwendung speichert extrahierte Texte, Analyseergebnisse und den Verarbeitungsverlauf auf der eigenen Infrastruktur des Verantwortlichen. Diese Daten werden bis zu 10 Jahre aufbewahrt.",
            "The application stores extracted text, analysis results and processing history on the controller's own infrastructure. This data is kept for up to 10 years.",
          ),
        ),
      ],
    },
    {
      id: "mistral",
      heading: text(
        "Weitergabe an Mistral AI zur Texterkennung",
        "Transfer to Mistral AI for text recognition",
      ),
      body: [
        paragraph(
          text(
            "Ist die Texterkennung (OCR) aktiviert, werden Dokumentinhalte zur Texterkennung an die Mistral AI SAS, 15 rue des Halles, 75001 Paris, Frankreich, übermittelt. Dies erfolgt im Rahmen der im Abschnitt „Verarbeitung von Dokumenten“ beschriebenen Verarbeitung. Für Speicherung und Verwendung der Daten durch Mistral AI gelten deren ",
            'When text recognition (OCR) is enabled, document contents are sent to Mistral AI SAS, 15 rue des Halles, 75001 Paris, France, for text recognition. This is part of the processing described in the "Document processing" section. Mistral AI\'s storage and use of the data are governed by its ',
          ),
          {
            text: text("Datenschutzerklärung", "privacy policy"),
            href: "https://legal.mistral.ai/terms/privacy-policy",
          },
          text(" und ", " and "),
          {
            text: text("Bedingungen", "terms"),
            href: "https://legal.mistral.ai/terms/commercial-terms-of-service",
          },
          text("."),
        ),
        paragraph(
          text(
            "Soweit Dienstleister von Mistral AI Daten außerhalb der EU verarbeiten, verwendet Mistral AI nach eigenen Angaben Standardvertragsklauseln der EU-Kommission.",
            "Where Mistral AI's service providers process data outside the EU, Mistral AI states that it uses the European Commission's Standard Contractual Clauses.",
          ),
        ),
      ],
    },
    {
      id: "email",
      heading: text("Kontakt per E-Mail", "Contact by e-mail"),
      body: [
        paragraph(
          text(
            "Wenn Sie per E-Mail Kontakt aufnehmen, werden Ihre E-Mail-Adresse, der Inhalt Ihrer Nachricht und die technischen Angaben der E-Mail verarbeitet, um Ihre Anfrage zu beantworten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, Anfragen beantworten zu können.",
            "If you contact us by e-mail, your e-mail address, the content of your message and the technical details of the e-mail are processed to answer your request. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is being able to answer requests.",
          ),
        ),
        paragraph(
          text(
            "Die E-Mail-Postfächer werden bei der Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australien, als Auftragsverarbeiter betrieben. Dabei können Daten in Länder außerhalb der EU übermittelt werden, insbesondere nach Australien, in die USA und nach Indien. Für diese Übermittlungen verwendet Fastmail Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO). Details: ",
            "The mailboxes are hosted by Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australia, as a processor. Data may be transferred to countries outside the EU, in particular Australia, the USA and India. For these transfers, Fastmail uses the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR). Details: ",
          ),
          {
            text: text("Datenschutzerklärung von Fastmail", "Fastmail privacy policy"),
            href: "https://www.fastmail.com/policies/privacy/",
          },
          text(", "),
          {
            text: text("Auftragsverarbeitungsvertrag", "data processing agreement"),
            href: "https://www.fastmail.com/policies/dpa/",
          },
          text(" und ", " and "),
          {
            text: text("Standardvertragsklauseln", "Standard Contractual Clauses"),
            href: "https://www.fastmail.com/policies/dpa/section3/",
          },
          text(
            ". Eine Kopie der Garantien erhalten Sie auf Anfrage an ",
            ". You can obtain a copy of the safeguards by writing to ",
          ),
          { text: text(operator.privacyEmail), href: `mailto:${operator.privacyEmail}` },
          text("."),
        ),
        paragraph(
          text(
            "Der Verantwortliche löscht Nachrichten nach Erledigung der Anfrage, soweit keine Aufbewahrung erforderlich ist. Bei Fastmail können anschließend noch Sicherungs- und Protokolldaten nach dessen veröffentlichten Löschregeln verbleiben.",
            "The controller deletes messages after dealing with the request unless retention remains necessary. Fastmail may subsequently retain backup and log data under its published deletion rules.",
          ),
        ),
      ],
    },
    {
      id: "storage",
      heading: text("Cookies und lokale Speicherung", "Cookies and local storage"),
      body: [
        paragraph(
          text(
            "Es werden nur technisch notwendige Cookies gesetzt (§ 25 Abs. 2 Nr. 2 TDDDG): nach der Anmeldung Sitzungs-Cookies des Anmeldedienstes Pangolin (gültig bis zu 30 Tage) und, wenn Sie die Sprache der Anwendung ändern, ein Cookie mit der gewählten Sprache (1 Jahr). Analyse- oder Werbe-Cookies werden nicht verwendet, und die Anwendung lädt keine Inhalte von Drittanbietern.",
            "Only technically necessary cookies are set (Section 25(2) no. 2 TDDDG): after sign-in, session cookies from the Pangolin sign-in service (valid for up to 30 days) and, if you change the application's language, a cookie storing your chosen language (1 year). No analytics or advertising cookies are used, and the application loads no third-party content.",
          ),
        ),
      ],
    },
    {
      id: "rights",
      heading: text("Ihre Rechte", "Your rights"),
      body: [
        paragraph(
          text(
            "Sie haben gegenüber dem Verantwortlichen folgende Rechte hinsichtlich Ihrer personenbezogenen Daten:",
            "You have the following rights regarding your personal data:",
          ),
        ),
        {
          type: "list",
          items: [
            [text("Auskunft (Art. 15 DSGVO)", "access (Art. 15 GDPR)")],
            [text("Berichtigung (Art. 16 DSGVO)", "rectification (Art. 16 GDPR)")],
            [text("Löschung (Art. 17 DSGVO)", "erasure (Art. 17 GDPR)")],
            [
              text(
                "Einschränkung der Verarbeitung (Art. 18 DSGVO)",
                "restriction of processing (Art. 18 GDPR)",
              ),
            ],
            [text("Datenübertragbarkeit (Art. 20 DSGVO)", "data portability (Art. 20 GDPR)")],
            [
              text(
                "Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3 DSGVO): Sie können eine erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der Verarbeitung vor dem Widerruf bleibt unberührt.",
                "withdrawal of consent (Art. 7(3) GDPR): you may withdraw consent at any time. Withdrawal does not affect the lawfulness of processing before withdrawal.",
              ),
            ],
          ],
        },
        paragraph(
          { strong: text("Widerspruchsrecht (Art. 21 DSGVO):", "Right to object (Art. 21 GDPR):") },
          text(
            " Soweit eine Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO beruht, können Sie aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit widersprechen.",
            " Where processing is based on Art. 6(1)(f) GDPR, you may object at any time on grounds relating to your particular situation.",
          ),
        ),
        paragraph(
          text(
            "Zur Ausübung Ihrer Rechte genügt eine Nachricht an ",
            "To exercise your rights, simply send a message to ",
          ),
          { text: text(operator.privacyEmail), href: `mailto:${operator.privacyEmail}` },
          text("."),
        ),
        paragraph(
          text(
            "Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem Mitgliedstaat Ihres gewöhnlichen Aufenthalts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes (Art. 77 DSGVO).",
            "You also have the right to lodge a complaint with a data protection supervisory authority, in particular in the member state of your habitual residence, place of work or place of the alleged infringement (Art. 77 GDPR).",
          ),
        ),
      ],
    },
    {
      id: "provision",
      heading: text("Pflicht zur Bereitstellung", "Obligation to provide data"),
      body: [
        paragraph(
          text(
            "Sie sind nicht verpflichtet, personenbezogene Daten bereitzustellen. Ohne die technisch notwendigen Verbindungsdaten kann die Website jedoch nicht ausgeliefert werden, und ohne Anmeldung sind die geschützten Bereiche nicht nutzbar.",
            "You are not obliged to provide personal data. However, the website cannot be delivered without the technically necessary connection data, and the protected areas cannot be used without signing in.",
          ),
        ),
      ],
    },
    {
      id: "changes",
      heading: text("Änderungen", "Changes"),
      body: [
        paragraph(
          text(
            "Diese Datenschutzerklärung wird angepasst, wenn sich die Website oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.",
            "This privacy policy is updated when the website or the legal situation changes. The version published here applies.",
          ),
        ),
      ],
    },
  ],
};

export const privacyDocuments = resolveDocuments(privacyDocument);
