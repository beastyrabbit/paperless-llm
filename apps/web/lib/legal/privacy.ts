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
            "Die auf dem Longhorn-Volume gespeicherten Anwendungsdaten, die Qdrant-Vektoren und die Daten von Pocket-ID werden gesichert. Sicherungskopien werden innerhalb der eigenen Infrastruktur gespeichert und nach spätestens drei Monaten überschrieben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt im Schutz vor Datenverlust.",
            "The application data stored on the Longhorn volume, the Qdrant vectors and Pocket-ID data are backed up. Backup copies are stored within the controller's own infrastructure and overwritten after at most three months. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is protection against data loss.",
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
            "Pangolin führt zusätzlich HTTP-Anfrageprotokolle (14 Tage), Anmeldeprotokolle (90 Tage) und Netzwerkprotokolle (30 Tage). Diese enthalten je nach Vorgang IP-Adresse, Zeitpunkt, angefragte Ressource mit Host und Pfad sowie Benutzerkennung und User-Agent. Zweck sind Betrieb und Sicherheit; Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
            "Pangolin also keeps HTTP request logs (14 days), authentication logs (90 days) and network logs (30 days). Depending on the event, these contain the IP address, time, requested resource including host and path, user identifier and user agent. Their purpose is operation and security; the legal basis is Art. 6(1)(f) GDPR.",
          ),
        ),
        paragraph(
          text(
            "Die Container-Protokolle der Anwendung enthalten je Anfrage Anfrage-ID, Methode, Pfad, Status und Dauer, jedoch weder Anfrageinhalt noch Abfrageparameter und im normalen Anfrageprotokoll keine IP-Adresse. Bei fehlgeschlagenen Anfragen werden zusätzlich Anfrage-Header mit geschwärzten Cookie- und Authorization-Werten protokolliert; dabei können IP-Adresse (X-Forwarded-For) und User-Agent enthalten sein. In Verarbeitungsprotokollen erscheinen Dokumenttitel. Die kurzlebigen Kubernetes-Container-Protokolle dienen Betrieb und Fehleranalyse auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Sie werden bei Logrotation oder Container-Neustart gelöscht, nicht zentral gesammelt und nicht gesichert. Davon zu unterscheiden sind die dauerhaft gespeicherten Verarbeitungsdaten im Abschnitt „Verarbeitung von Dokumenten“.",
            'The application\'s container logs contain the request ID, method, path, status and duration for each request, but no request body or query parameters and no IP address in the normal request log. Failed requests also log request headers with Cookie and Authorization values masked; these may include the IP address (X-Forwarded-For) and user agent. Document titles appear in processing logs. The short-lived Kubernetes container logs serve operation and error analysis on the basis of Art. 6(1)(f) GDPR. They are deleted on log rotation or container restart, are not centrally collected and are not backed up. These are distinct from the persistently stored processing data in the "Document processing" section.',
          ),
        ),
        paragraph(
          text(
            "Lokale CrowdSec-Meldungen und Sperrentscheidungen enthalten IP-Adresse, Zeitpunkt und Angriffsart. Meldungen werden normalerweise nach 7 Tagen entfernt, bei höchstens 5.000 Einträgen; Meldungen zu aktiven Sperren bleiben bis zum Ende der Sperre erhalten. Lokale Sperren dauern 4 Stunden; aus der Community-Sperrliste übernommene Sperren können länger gelten. Zweck ist die Angriffsabwehr auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.",
            "Local CrowdSec alerts and blocking decisions contain the IP address, time and type of attack. Alerts are normally removed after 7 days, with a maximum of 5,000 entries; alerts linked to active blocks are kept until the block ends. Local blocks last 4 hours; blocks adopted from the community blocklist may last longer. Their purpose is defence against attacks on the basis of Art. 6(1)(f) GDPR.",
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
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, den Zugang auf berechtigte Personen zu beschränken. Das Benutzerkonto in Pocket-ID und Pangolin besteht, solange der Zugang eingeräumt ist, und wird auf Anfrage oder nach Entzug des Zugangs gelöscht. Anmeldeprotokolle werden nach 90 Tagen gelöscht. Sicherungskopien werden nach spätestens drei Monaten überschrieben.",
            "The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is restricting access to authorised people. The user account in Pocket-ID and Pangolin exists for as long as access is granted and is deleted on request or after access is withdrawn. Sign-in logs are deleted after 90 days. Backup copies are overwritten after at most three months.",
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
            "Die Dokumente stammen aus dem selbst betriebenen Paperless-ngx des Verantwortlichen auf eigener Infrastruktur. Es handelt sich um seine persönlichen Unterlagen, die auch personenbezogene Daten Dritter enthalten können, etwa von Korrespondenten, Absendern und in Briefen genannten Personen. Die Verarbeitung der Dokumentinhalte dient ausschließlich persönlichen oder familiären Zwecken des Verantwortlichen im Sinne von Art. 2 Abs. 2 lit. c DSGVO.",
            "The documents come from the controller's self-hosted Paperless-ngx on his own infrastructure. They are his personal papers and may also contain personal data of third parties, such as correspondents, senders and people named in letters. The processing of document contents serves exclusively the controller's personal or household purposes within the meaning of Art. 2(2)(c) GDPR.",
          ),
        ),
        paragraph(
          text(
            "Die Sprachmodellanalyse läuft mit lokalen Modellen auf einem Ollama-Server im eigenen Netzwerk. Die Prompts enthalten Titel, Dateinamen, Erstellungsdatum, Korrespondent, Dokumenttyp, Tag-Namen, bis zu 12.000 Zeichen Dokumentinhalt sowie den Katalog der Tags, Korrespondenten und Dokumenttypen. Für Embeddings werden die ersten 8.000 Zeichen verarbeitet. Die Vektoren werden in einem selbst betriebenen Qdrant mit Dokument-ID, Titel, Tags, Korrespondent und Dokumenttyp gespeichert; der vollständige Text wird dort nicht gespeichert.",
            "Language-model analysis uses local models on an Ollama server in the controller's own network. Prompts contain the title, file names, creation date, correspondent, document type, tag names, up to 12,000 characters of document content and the catalogue of tags, correspondents and document types. The first 8,000 characters are processed for embeddings. Vectors are stored in a self-hosted Qdrant with the document ID, title, tags, correspondent and document type; the full text is not stored there.",
          ),
        ),
        paragraph(
          text(
            "Ergebnisse werden in Paperless-ngx zurückgeschrieben: Titel, Tags, Korrespondent, Dokumenttyp, benutzerdefinierte Felder und OCR-Text.",
            "Results are written back to Paperless-ngx: title, tags, correspondent, document type, custom fields and OCR text.",
          ),
        ),
        paragraph(
          text(
            "Die Anwendung speichert auf eigener Infrastruktur in Deutschland in der Datei tinybase.json auf einem Longhorn-Volume den vollständigen OCR-Text je Dokument, Agenten-Transkripte mit Prompts einschließlich Dokumentauszügen, Werkzeugaufrufen und Modellantworten, Verarbeitungsprotokolle, Prüfvorschläge, Fallfragen und Antworten sowie Einstellungen. Diese Daten dienen der Dokumentverarbeitung und ihrer Nachvollziehbarkeit. Sie und die Qdrant-Vektoren bleiben derzeit ohne automatische Löschfrist bis zur manuellen Löschung gespeichert. Verarbeitungsprotokolle können in den Einstellungen gelöscht werden. Für Sicherungskopien gilt der Abschnitt „Hosting und Bereitstellung“.",
            'On the controller\'s own infrastructure in Germany, the application stores the complete OCR text per document, agent transcripts with prompts including document excerpts, tool calls and model replies, processing logs, review suggestions, case questions and answers, and settings in the tinybase.json file on a Longhorn volume. This data supports document processing and its traceability. This data and the Qdrant vectors are currently stored without an automatic deletion period, until manually deleted. Processing logs can be deleted in Settings. The "Hosting and delivery" section applies to backup copies.',
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
            "Wenn die Texterkennung (OCR) aktiviert ist, wird die vollständige Dokumentdatei (PDF) zur Texterkennung an Mistral AI SAS, 15 rue des Halles, 75001 Paris, Frankreich, übermittelt. Mistral AI hat seinen Sitz in der EU. Soweit Dienstleister von Mistral AI personenbezogene Daten außerhalb der EU verarbeiten, verwendet Mistral AI nach eigenen Angaben Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO). OCR ist derzeit aktiviert. Die Übermittlung erfolgt im Rahmen der im Abschnitt „Verarbeitung von Dokumenten“ beschriebenen Verarbeitung zu ausschließlich persönlichen oder familiären Zwecken des Verantwortlichen (Art. 2 Abs. 2 lit. c DSGVO).",
            "When text recognition (OCR) is enabled, the complete document file (PDF) is sent to Mistral AI SAS, 15 rue des Halles, 75001 Paris, France, for text recognition. Mistral AI is established in the EU. Where Mistral AI's service providers process personal data outside the EU, Mistral AI states that it uses the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR). OCR is currently enabled. The transfer is part of the processing described in the \"Document processing\" section for exclusively the controller's personal or household purposes (Art. 2(2)(c) GDPR).",
          ),
        ),
        paragraph(
          text(
            "Für die eigene Speicherung und Verwendung der Daten durch Mistral AI gelten dessen veröffentlichte Informationen: ",
            "For Mistral AI's own retention and use of the data, see its published information: ",
          ),
          {
            text: text("Datenschutzerklärung", "privacy policy"),
            href: "https://legal.mistral.ai/terms/privacy-policy",
          },
          text(", "),
          {
            text: text("Bedingungen", "terms"),
            href: "https://legal.mistral.ai/terms/commercial-terms-of-service",
          },
          text(" und ", " and "),
          {
            text: text("Auftragsverarbeitungsbedingungen", "data processing addendum"),
            href: "https://legal.mistral.ai/terms/data-processing-addendum",
          },
          text("."),
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
        {
          type: "table",
          headers: [
            text("Name"),
            text("Anbieter", "Provider"),
            text("Zweck", "Purpose"),
            text("Dauer", "Duration"),
            text("Technische Erforderlichkeit", "Technical necessity"),
          ],
          rows: [
            [
              text("NEXT_LOCALE"),
              text(
                "Verantwortlicher, paperless-llm.heerlab.com",
                "Controller, paperless-llm.heerlab.com",
              ),
              text(
                "Speichert die gewählte Sprache (en/de); wird erst bei einem Sprachwechsel in den Einstellungen gesetzt.",
                "Stores the selected language (en/de); set only when changing language in Settings.",
              ),
              text("1 Jahr", "1 year"),
              text(
                "Für die gewünschte Sprachfunktion erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
                "Required for the requested language function (Section 25(2) no. 2 TDDDG).",
              ),
            ],
            [
              text("p_session_token"),
              text("Pangolin, pangolin.heerlab.com"),
              text(
                "Hält die Anmeldung beim Anmeldedienst Pangolin während der SSO-Anmeldung; HttpOnly, Secure, SameSite=Lax.",
                "Keeps the sign-in at the Pangolin sign-in service during SSO; HttpOnly, Secure, SameSite=Lax.",
              ),
              text("30 Tage", "30 days"),
              text(
                "Für die Anmeldung erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
                "Required for sign-in (Section 25(2) no. 2 TDDDG).",
              ),
            ],
            [
              text("p_session_token_s.<Zeitstempel>", "p_session_token_s.<timestamp>"),
              text("Pangolin, paperless-llm.heerlab.com"),
              text(
                "Erhält nach der Anmeldung die SSO-Sitzung; HttpOnly, Secure, SameSite=Lax.",
                "Maintains the SSO session after sign-in; HttpOnly, Secure, SameSite=Lax.",
              ),
              text("30 Tage", "30 days"),
              text(
                "Für den geschützten Zugang erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
                "Required for protected access (Section 25(2) no. 2 TDDDG).",
              ),
            ],
          ],
        },
        paragraph(
          text(
            "Die Anwendung verwendet weder localStorage noch sessionStorage oder IndexedDB. Der Browser lädt keine externen Schriftarten, CDN-Inhalte oder Analysedienste; Anwendungsanfragen laufen über den /api-Proxy unter derselben Herkunft.",
            "The application uses neither localStorage nor sessionStorage nor IndexedDB. The browser loads no external fonts, CDN content or analytics services; application requests use the same-origin /api proxy.",
          ),
        ),
        paragraph(
          text(
            "Pocket-ID setzt während der Anmeldung eigene Cookies auf pocket-id.heerlab.com. Die vier rechtlichen Informationsseiten setzen selbst keine Cookies und laden keine weiteren Ressourcen.",
            "Pocket-ID sets its own cookies on pocket-id.heerlab.com during sign-in. The four legal information pages themselves set no cookies and load no additional resources.",
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
