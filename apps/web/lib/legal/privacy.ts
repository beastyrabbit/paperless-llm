import { type LegalDocument, type LegalLocale, operator, site } from "./shared";

export const privacyDocuments: Record<LegalLocale, LegalDocument> = {
  de: {
    title: "Datenschutzerklärung",
    updated: site.updated.de,
    sections: [
      {
        id: "controller",
        heading: "Verantwortlicher",
        body: [
          {
            type: "paragraph",
            content: [
              `Verantwortlich für die Verarbeitung personenbezogener Daten auf ${site.url} ist:`,
            ],
          },
          {
            type: "operator",
          },
          {
            type: "paragraph",
            content: [
              "E-Mail: ",
              {
                text: operator.privacyEmail,
                href: `mailto:${operator.privacyEmail}`,
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              "Ein Datenschutzbeauftragter ist nicht bestellt, da hierzu keine gesetzliche Pflicht besteht.",
            ],
          },
        ],
      },
      {
        id: "overview",
        heading: "Überblick",
        body: [
          {
            type: "paragraph",
            content: [
              `Diese Erklärung informiert darüber, welche personenbezogenen Daten bei der Nutzung von ${site.name} verarbeitet werden, zu welchen Zwecken, auf welcher Rechtsgrundlage und wie lange. ${site.name} ist ein privates, nicht-kommerzielles Projekt. Als internes Werkzeug analysiert es die eigenen Dokumente des Verantwortlichen aus seinem selbst betriebenen Paperless-ngx mit Sprachmodellen, schlägt Metadaten wie Titel, Korrespondent, Dokumenttyp, Tags und benutzerdefinierte Felder vor oder wendet sie an und bietet optional Texterkennung (OCR).`,
            ],
          },
          {
            type: "paragraph",
            content: [
              "Personenbezogene Daten werden nicht verkauft und nicht für Werbung verwendet. Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO findet nicht statt.",
            ],
          },
        ],
      },
      {
        id: "hosting",
        heading: "Hosting und Bereitstellung",
        body: [
          {
            type: "paragraph",
            content: [
              `${site.name} läuft auf eigener Server-Infrastruktur des Verantwortlichen in Deutschland. Aufrufe aus dem Internet erreichen die Anwendung über einen Reverse-Proxy auf einem virtuellen Server der netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Deutschland (Rechenzentrum in Nürnberg). netcup verarbeitet die Daten dabei als Auftragsverarbeiter; mit netcup besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. Die Verbindung ist bis zum Reverse-Proxy TLS-verschlüsselt und wird von dort durch einen verschlüsselten Tunnel an die eigene Infrastruktur weitergeleitet.`,
            ],
          },
          {
            type: "paragraph",
            content: [
              "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in einer sicheren und zuverlässigen Bereitstellung der Website.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die auf dem Longhorn-Volume gespeicherten Anwendungsdaten und die Daten von Pocket-ID werden lokal in der eigenen Infrastruktur gesichert. Sicherungskopien der Pocket-ID-Datenbanken werden zusätzlich in einem Rechenzentrum in Deutschland abgelegt; dort können auch ältere Sicherungskopien der Anwendungsdaten vorhanden sein. Sicherungskopien werden derzeit ohne feste Löschfrist aufbewahrt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt im Schutz vor Datenverlust.",
            ],
          },
        ],
      },
      {
        id: "logs",
        heading: "Server-Logfiles",
        body: [
          {
            type: "paragraph",
            content: ["Bei jedem Aufruf speichert der Reverse-Proxy automatisch folgende Daten:"],
          },
          {
            type: "list",
            items: [
              ["IP-Adresse des anfragenden Geräts"],
              ["Datum und Uhrzeit des Zugriffs"],
              ["aufgerufene Adresse (Pfad einschließlich Parameter), HTTP-Methode und Protokoll"],
              ["HTTP-Statuscode, übertragene Datenmenge und Antwortzeit"],
              ["Browser-Kennung (User-Agent)"],
              ["verwendete TLS-Version und Verschlüsselung"],
              ["angesprochener Dienst"],
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die Header Cookie und Authorization werden geschwärzt. URL-Pfade und Abfrageparameter werden protokolliert.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die Daten dienen dem Betrieb, der Fehleranalyse und der Abwehr von Angriffen und Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in Stabilität und Sicherheit des Angebots. Die Logfiles werden nach 14 Tagen automatisch gelöscht.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Pangolin führt zusätzlich HTTP-Anfrageprotokolle (14 Tage), Anmeldeprotokolle (90 Tage) und Netzwerkprotokolle (30 Tage). Diese enthalten je nach Vorgang IP-Adresse, Zeitpunkt, angefragte Ressource mit Host und Pfad sowie Benutzerkennung und User-Agent. Zweck sind Betrieb und Sicherheit; Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die Container-Protokolle der Anwendung enthalten je Anfrage Anfrage-ID, Methode, Pfad, Status und Dauer, jedoch weder Anfrageinhalt noch Abfrageparameter und im normalen Anfrageprotokoll keine IP-Adresse. Bei fehlgeschlagenen Anfragen werden zusätzlich Anfrage-Header mit geschwärzten Cookie- und Authorization-Werten protokolliert; dabei können IP-Adresse (X-Forwarded-For) und User-Agent enthalten sein. In Verarbeitungsprotokollen erscheinen Dokumenttitel. Die kurzlebigen Kubernetes-Container-Protokolle dienen Betrieb und Fehleranalyse auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Sie werden bei Logrotation oder Container-Neustart gelöscht, nicht zentral gesammelt und nicht gesichert. Davon zu unterscheiden sind die dauerhaft gespeicherten Verarbeitungsdaten im Abschnitt „Verarbeitung von Dokumenten“.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Lokale CrowdSec-Meldungen und Sperrentscheidungen enthalten IP-Adresse, Zeitpunkt und Angriffsart. Meldungen werden normalerweise nach 7 Tagen entfernt, bei höchstens 5.000 Einträgen; Meldungen zu aktiven Sperren bleiben bis zum Ende der Sperre erhalten. Lokale Sperren dauern 4 Stunden; aus der Community-Sperrliste übernommene Sperren können länger gelten. Zweck ist die Angriffsabwehr auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.",
            ],
          },
        ],
      },
      {
        id: "crowdsec",
        heading: "Schutz vor Angriffen (CrowdSec)",
        body: [
          {
            type: "paragraph",
            content: [
              "Zum Schutz vor Angriffen wertet die Sicherheitssoftware CrowdSec die Server-Logfiles automatisch aus und sperrt IP-Adressen, von denen erkennbar Angriffe ausgehen (zum Beispiel massenhafte Anmeldeversuche oder das Ausspähen von Schwachstellen). Erkennt CrowdSec einen Angriff, werden die IP-Adresse, der Zeitpunkt und die Art des Angriffs an die CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, Frankreich, übermittelt. CrowdSec nutzt diese Meldungen für eine gemeinsame Sperrliste, die Angriffe auf viele Server abwehrt. Bei normalem Surfen werden keine Daten an CrowdSec übermittelt.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt im Schutz der Website und ihrer Nutzer vor Angriffen.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Für diese Verarbeitung sind der Verantwortliche und CrowdSec nach Angaben von CrowdSec gemeinsam verantwortlich (Art. 26 DSGVO): CrowdSec ist für den Betrieb seiner zentralen Dienste und Sperrlisten verantwortlich, der Verantwortliche für den Einsatz auf diesem Server. Sie können Ihre Rechte gegenüber beiden geltend machen, bei CrowdSec unter ",
              {
                text: "dpo@crowdsec.net",
                href: "mailto:dpo@crowdsec.net",
              },
              ". CrowdSec kann die gemeldeten Daten an Mitglieder und Partner seines Netzwerks weitergeben. Übermittlungen in Länder außerhalb der EU erfolgen nach Angaben von CrowdSec auf Grundlage von Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO).",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Vollständige IP-Adressen werden grundsätzlich höchstens drei Monate gespeichert und anschließend schrittweise verallgemeinert. Für bestimmte Angriffsanalysen und Trainingszwecke nennt CrowdSec Ausnahmen von bis zu einem Jahr vor der Anonymisierung. Details: ",
              {
                text: "crowdsec.net/privacy-policy",
                href: "https://www.crowdsec.net/privacy-policy",
              },
              ".",
            ],
          },
        ],
      },
      {
        id: "sso",
        heading: "Anmeldung (Single Sign-On)",
        body: [
          {
            type: "paragraph",
            content: [
              `${site.name} ist nur für eingeladene Personen zugänglich. Die Anmeldung erfolgt über den Reverse-Proxy Pangolin mit dem selbst betriebenen Identitätsdienst Pocket-ID auf der eigenen Infrastruktur. Dabei werden Benutzername, E-Mail-Adresse, Gruppenzugehörigkeit, Zeitpunkt der Anmeldung und IP-Adresse verarbeitet. Nach der Anmeldung setzt Pangolin ein Sitzungs-Cookie, das für den Zugang technisch erforderlich ist.`,
            ],
          },
          {
            type: "paragraph",
            content: [
              "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, den Zugang auf berechtigte Personen zu beschränken. Das Benutzerkonto in Pocket-ID und Pangolin besteht, solange der Zugang eingeräumt ist, und wird auf Anfrage oder nach Entzug des Zugangs gelöscht. Anmeldeprotokolle werden nach 90 Tagen gelöscht. Sicherungskopien der Datenbanken werden derzeit ohne feste Löschfrist aufbewahrt (siehe Abschnitt „Hosting und Bereitstellung“).",
            ],
          },
          {
            type: "paragraph",
            content: ["Die rechtlichen Informationsseiten sind ohne Anmeldung zugänglich."],
          },
        ],
      },
      {
        id: "documents",
        heading: "Verarbeitung von Dokumenten",
        body: [
          {
            type: "paragraph",
            content: [
              "Die Dokumente stammen aus dem selbst betriebenen Paperless-ngx des Verantwortlichen auf eigener Infrastruktur. Es handelt sich um seine persönlichen Unterlagen, die auch personenbezogene Daten Dritter enthalten können, etwa von Korrespondenten, Absendern und in Briefen genannten Personen. Die Verarbeitung der Dokumentinhalte dient ausschließlich persönlichen oder familiären Zwecken des Verantwortlichen im Sinne von Art. 2 Abs. 2 lit. c DSGVO.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die Sprachmodellanalyse läuft mit lokalen Modellen auf einem Ollama-Server im eigenen Netzwerk. Die Prompts enthalten Titel, Dateinamen, Erstellungsdatum, Korrespondent, Dokumenttyp, Tag-Namen, bis zu 12.000 Zeichen Dokumentinhalt sowie den Katalog der Tags, Korrespondenten und Dokumenttypen. Für Embeddings werden die ersten 8.000 Zeichen verarbeitet. Die Vektoren werden in einem selbst betriebenen Qdrant mit Dokument-ID, Titel, Tags, Korrespondent und Dokumenttyp gespeichert; der vollständige Text wird dort nicht gespeichert.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Ergebnisse werden in Paperless-ngx zurückgeschrieben: Titel, Tags, Korrespondent, Dokumenttyp, benutzerdefinierte Felder und OCR-Text.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die Anwendung speichert auf eigener Infrastruktur in Deutschland in der Datei tinybase.json auf einem Longhorn-Volume den vollständigen OCR-Text je Dokument, Agenten-Transkripte mit Prompts einschließlich Dokumentauszügen, Werkzeugaufrufen und Modellantworten, Verarbeitungsprotokolle, Prüfvorschläge, Fallfragen und Antworten sowie Einstellungen. Diese Daten dienen der Dokumentverarbeitung und ihrer Nachvollziehbarkeit. Sie und die Qdrant-Vektoren bleiben derzeit ohne automatische Löschfrist bis zur manuellen Löschung gespeichert. Verarbeitungsprotokolle können in den Einstellungen gelöscht werden. Für Sicherungskopien gilt der Abschnitt „Hosting und Bereitstellung“.",
            ],
          },
        ],
      },
      {
        id: "mistral",
        heading: "Weitergabe an Mistral AI zur Texterkennung",
        body: [
          {
            type: "paragraph",
            content: [
              "Wenn die Texterkennung (OCR) aktiviert ist, wird die vollständige Dokumentdatei (PDF) zur Texterkennung an Mistral AI SAS, 15 rue des Halles, 75001 Paris, Frankreich, übermittelt. OCR ist derzeit aktiviert. Die Übermittlung erfolgt im Rahmen der im Abschnitt „Verarbeitung von Dokumenten“ beschriebenen Verarbeitung zu ausschließlich persönlichen oder familiären Zwecken des Verantwortlichen (Art. 2 Abs. 2 lit. c DSGVO).",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Für die eigene Speicherung und Verwendung der Daten durch Mistral AI gelten dessen veröffentlichte Informationen: ",
              {
                text: "Datenschutzerklärung",
                href: "https://legal.mistral.ai/terms/privacy-policy",
              },
              ", ",
              {
                text: "Bedingungen",
                href: "https://legal.mistral.ai/terms/commercial-terms-of-service",
              },
              " und ",
              {
                text: "Auftragsverarbeitungsbedingungen",
                href: "https://legal.mistral.ai/terms/data-processing-addendum",
              },
              ".",
            ],
          },
        ],
      },
      {
        id: "email",
        heading: "Kontakt per E-Mail",
        body: [
          {
            type: "paragraph",
            content: [
              "Wenn Sie per E-Mail Kontakt aufnehmen, werden Ihre E-Mail-Adresse, der Inhalt Ihrer Nachricht und die technischen Angaben der E-Mail verarbeitet, um Ihre Anfrage zu beantworten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, Anfragen beantworten zu können.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die E-Mail-Postfächer werden bei der Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australien, als Auftragsverarbeiter betrieben. Dabei können Daten in Länder außerhalb der EU übermittelt werden, insbesondere nach Australien, in die USA und nach Indien. Für diese Übermittlungen verwendet Fastmail Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO). Details: ",
              {
                text: "Datenschutzerklärung von Fastmail",
                href: "https://www.fastmail.com/policies/privacy/",
              },
              ", ",
              {
                text: "Auftragsverarbeitungsvertrag",
                href: "https://www.fastmail.com/policies/dpa/",
              },
              " und ",
              {
                text: "Standardvertragsklauseln",
                href: "https://www.fastmail.com/policies/dpa/section3/",
              },
              ". Eine Kopie der Garantien erhalten Sie auf Anfrage an ",
              {
                text: operator.privacyEmail,
                href: `mailto:${operator.privacyEmail}`,
              },
              ".",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Der Verantwortliche löscht Nachrichten nach Erledigung der Anfrage, soweit keine Aufbewahrung erforderlich ist. Bei Fastmail können anschließend noch Sicherungs- und Protokolldaten nach dessen veröffentlichten Löschregeln verbleiben.",
            ],
          },
        ],
      },
      {
        id: "storage",
        heading: "Cookies und lokale Speicherung",
        body: [
          {
            type: "table",
            headers: ["Name", "Anbieter", "Zweck", "Dauer", "Technische Erforderlichkeit"],
            rows: [
              [
                "NEXT_LOCALE",
                "Verantwortlicher, paperless-llm.heerlab.com",
                "Speichert die gewählte Sprache (en/de); wird erst bei einem Sprachwechsel in den Einstellungen gesetzt.",
                "1 Jahr",
                "Für die gewünschte Sprachfunktion erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
              ],
              [
                "p_session_token_s.<Zeitstempel>",
                "Pangolin, paperless-llm.heerlab.com",
                "Erhält nach der Anmeldung die SSO-Sitzung; HttpOnly, Secure, SameSite=Lax.",
                "30 Tage",
                "Für den geschützten Zugang erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG).",
              ],
            ],
          },
          {
            type: "paragraph",
            content: [
              "Die Anwendung verwendet weder localStorage noch sessionStorage oder IndexedDB. Der Browser lädt keine externen Schriftarten, CDN-Inhalte oder Analysedienste; Anwendungsanfragen laufen über den /api-Proxy unter derselben Herkunft.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Pocket-ID setzt während der Anmeldung eigene Cookies auf pocket-id.heerlab.com. Die vier rechtlichen Informationsseiten setzen selbst keine Cookies und laden keine weiteren Ressourcen.",
            ],
          },
        ],
      },
      {
        id: "rights",
        heading: "Ihre Rechte",
        body: [
          {
            type: "paragraph",
            content: [
              "Sie haben gegenüber dem Verantwortlichen folgende Rechte hinsichtlich Ihrer personenbezogenen Daten:",
            ],
          },
          {
            type: "list",
            items: [
              ["Auskunft (Art. 15 DSGVO)"],
              ["Berichtigung (Art. 16 DSGVO)"],
              ["Löschung (Art. 17 DSGVO)"],
              ["Einschränkung der Verarbeitung (Art. 18 DSGVO)"],
              ["Datenübertragbarkeit (Art. 20 DSGVO)"],
              [
                "Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3 DSGVO): Sie können eine erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der Verarbeitung vor dem Widerruf bleibt unberührt.",
              ],
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                strong: "Widerspruchsrecht (Art. 21 DSGVO):",
              },
              " Soweit eine Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO beruht, können Sie aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit widersprechen.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Zur Ausübung Ihrer Rechte genügt eine Nachricht an ",
              {
                text: operator.privacyEmail,
                href: `mailto:${operator.privacyEmail}`,
              },
              ".",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem Mitgliedstaat Ihres gewöhnlichen Aufenthalts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes (Art. 77 DSGVO).",
            ],
          },
        ],
      },
      {
        id: "provision",
        heading: "Pflicht zur Bereitstellung",
        body: [
          {
            type: "paragraph",
            content: [
              "Sie sind nicht verpflichtet, personenbezogene Daten bereitzustellen. Ohne die technisch notwendigen Verbindungsdaten kann die Website jedoch nicht ausgeliefert werden, und ohne Anmeldung sind die geschützten Bereiche nicht nutzbar.",
            ],
          },
        ],
      },
      {
        id: "changes",
        heading: "Änderungen",
        body: [
          {
            type: "paragraph",
            content: [
              "Diese Datenschutzerklärung wird angepasst, wenn sich die Website oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.",
            ],
          },
        ],
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    updated: site.updated.en,
    sections: [
      {
        id: "controller",
        heading: "Controller",
        body: [
          {
            type: "paragraph",
            content: [`The controller responsible for processing personal data on ${site.url} is:`],
          },
          {
            type: "operator",
          },
          {
            type: "paragraph",
            content: [
              "E-mail: ",
              {
                text: operator.privacyEmail,
                href: `mailto:${operator.privacyEmail}`,
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              "No data protection officer has been appointed, as there is no legal obligation to do so.",
            ],
          },
        ],
      },
      {
        id: "overview",
        heading: "Overview",
        body: [
          {
            type: "paragraph",
            content: [
              `This policy explains which personal data is processed when you use ${site.name}, for what purposes, on which legal basis, and for how long. ${site.name} is a private, non-commercial project. As an internal tool, it uses language models to analyse the controller's own documents from his self-hosted Paperless-ngx, suggests or applies metadata such as title, correspondent, document type, tags and custom fields, and offers optional text recognition (OCR).`,
            ],
          },
          {
            type: "paragraph",
            content: [
              "Personal data is not sold and not used for advertising. There is no automated decision-making, including profiling, within the meaning of Art. 22 GDPR.",
            ],
          },
        ],
      },
      {
        id: "hosting",
        heading: "Hosting and delivery",
        body: [
          {
            type: "paragraph",
            content: [
              `${site.name} runs on the controller's own server infrastructure in Germany. Requests from the internet reach the application through a reverse proxy on a virtual server operated by netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Germany (data center in Nuremberg). netcup processes the data as a processor under a data processing agreement pursuant to Art. 28 GDPR. The connection is TLS-encrypted up to the reverse proxy and forwarded from there to the controller's infrastructure through an encrypted tunnel.`,
            ],
          },
          {
            type: "paragraph",
            content: [
              "The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the secure and reliable provision of the website.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "The application data stored on the Longhorn volume and Pocket-ID data are backed up locally on the controller's own infrastructure. Backup copies of the Pocket-ID databases are also stored in a data center in Germany; older backup copies of the application data may also be present there. Backup copies are currently kept without a fixed deletion period. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is protection against data loss.",
            ],
          },
        ],
      },
      {
        id: "logs",
        heading: "Server log files",
        body: [
          {
            type: "paragraph",
            content: [
              "For every request, the reverse proxy automatically stores the following data:",
            ],
          },
          {
            type: "list",
            items: [
              ["IP address of the requesting device"],
              ["date and time of access"],
              ["requested address (path including parameters), HTTP method and protocol"],
              ["HTTP status code, amount of data transferred, and response time"],
              ["browser identifier (user agent)"],
              ["TLS version and cipher used"],
              ["target service"],
            ],
          },
          {
            type: "paragraph",
            content: [
              "The Cookie and Authorization headers are redacted. URL paths and query parameters are logged.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "This data is used to operate the site, analyse errors, and defend against attacks and abuse. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the stability and security of the service. Log files are deleted automatically after 14 days.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Pangolin also keeps HTTP request logs (14 days), authentication logs (90 days) and network logs (30 days). Depending on the event, these contain the IP address, time, requested resource including host and path, user identifier and user agent. Their purpose is operation and security; the legal basis is Art. 6(1)(f) GDPR.",
            ],
          },
          {
            type: "paragraph",
            content: [
              'The application\'s container logs contain the request ID, method, path, status and duration for each request, but no request body or query parameters and no IP address in the normal request log. Failed requests also log request headers with Cookie and Authorization values masked; these may include the IP address (X-Forwarded-For) and user agent. Document titles appear in processing logs. The short-lived Kubernetes container logs serve operation and error analysis on the basis of Art. 6(1)(f) GDPR. They are deleted on log rotation or container restart, are not centrally collected and are not backed up. These are distinct from the persistently stored processing data in the "Document processing" section.',
            ],
          },
          {
            type: "paragraph",
            content: [
              "Local CrowdSec alerts and blocking decisions contain the IP address, time and type of attack. Alerts are normally removed after 7 days, with a maximum of 5,000 entries; alerts linked to active blocks are kept until the block ends. Local blocks last 4 hours; blocks adopted from the community blocklist may last longer. Their purpose is defence against attacks on the basis of Art. 6(1)(f) GDPR.",
            ],
          },
        ],
      },
      {
        id: "crowdsec",
        heading: "Protection against attacks (CrowdSec)",
        body: [
          {
            type: "paragraph",
            content: [
              "To protect against attacks, the security software CrowdSec automatically analyses the server log files and blocks IP addresses that are clearly the source of attacks (for example mass login attempts or scanning for vulnerabilities). When CrowdSec detects an attack, the IP address, time and type of attack are sent to CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, France. CrowdSec uses these reports for a shared blocklist that protects many servers. No data is sent to CrowdSec during normal browsing.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is protecting the website and its users from attacks.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "According to CrowdSec, the controller and CrowdSec are jointly responsible for this processing (Art. 26 GDPR): CrowdSec is responsible for operating its central services and blocklists, the controller for its use on this server. You can exercise your rights against either of them; CrowdSec can be reached at ",
              {
                text: "dpo@crowdsec.net",
                href: "mailto:dpo@crowdsec.net",
              },
              ". CrowdSec may pass the reported data on to members and partners of its network. According to CrowdSec, transfers to countries outside the EU are based on the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR).",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Full IP addresses are generally retained for no more than three months and then progressively generalised. CrowdSec describes exceptions of up to one year before anonymisation for certain attack analyses and training purposes. Details: ",
              {
                text: "crowdsec.net/privacy-policy",
                href: "https://www.crowdsec.net/privacy-policy",
              },
              ".",
            ],
          },
        ],
      },
      {
        id: "sso",
        heading: "Sign-in (single sign-on)",
        body: [
          {
            type: "paragraph",
            content: [
              `${site.name} is only accessible to invited people. Sign-in is handled by the Pangolin reverse proxy with Pocket-ID, an identity service self-hosted on the controller's infrastructure. This processes your user name, e-mail address, group membership, time of sign-in and IP address. After sign-in, Pangolin sets a session cookie that is technically required for access.`,
            ],
          },
          {
            type: "paragraph",
            content: [
              'The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is restricting access to authorised people. The user account in Pocket-ID and Pangolin exists for as long as access is granted and is deleted on request or after access is withdrawn. Sign-in logs are deleted after 90 days. Database backup copies are currently kept without a fixed deletion period (see the "Hosting and delivery" section).',
            ],
          },
          {
            type: "paragraph",
            content: ["The legal information pages are accessible without signing in."],
          },
        ],
      },
      {
        id: "documents",
        heading: "Document processing",
        body: [
          {
            type: "paragraph",
            content: [
              "The documents come from the controller's self-hosted Paperless-ngx on his own infrastructure. They are his personal papers and may also contain personal data of third parties, such as correspondents, senders and people named in letters. The processing of document contents serves exclusively the controller's personal or household purposes within the meaning of Art. 2(2)(c) GDPR.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Language-model analysis uses local models on an Ollama server in the controller's own network. Prompts contain the title, file names, creation date, correspondent, document type, tag names, up to 12,000 characters of document content and the catalogue of tags, correspondents and document types. The first 8,000 characters are processed for embeddings. Vectors are stored in a self-hosted Qdrant with the document ID, title, tags, correspondent and document type; the full text is not stored there.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Results are written back to Paperless-ngx: title, tags, correspondent, document type, custom fields and OCR text.",
            ],
          },
          {
            type: "paragraph",
            content: [
              'On the controller\'s own infrastructure in Germany, the application stores the complete OCR text per document, agent transcripts with prompts including document excerpts, tool calls and model replies, processing logs, review suggestions, case questions and answers, and settings in the tinybase.json file on a Longhorn volume. This data supports document processing and its traceability. This data and the Qdrant vectors are currently stored without an automatic deletion period, until manually deleted. Processing logs can be deleted in Settings. The "Hosting and delivery" section applies to backup copies.',
            ],
          },
        ],
      },
      {
        id: "mistral",
        heading: "Transfer to Mistral AI for text recognition",
        body: [
          {
            type: "paragraph",
            content: [
              'When text recognition (OCR) is enabled, the complete document file (PDF) is sent to Mistral AI SAS, 15 rue des Halles, 75001 Paris, France, for text recognition. OCR is currently enabled. The transfer is part of the processing described in the "Document processing" section for exclusively the controller\'s personal or household purposes (Art. 2(2)(c) GDPR).',
            ],
          },
          {
            type: "paragraph",
            content: [
              "For Mistral AI's own retention and use of the data, see its published information: ",
              {
                text: "privacy policy",
                href: "https://legal.mistral.ai/terms/privacy-policy",
              },
              ", ",
              {
                text: "terms",
                href: "https://legal.mistral.ai/terms/commercial-terms-of-service",
              },
              " and ",
              {
                text: "data processing addendum",
                href: "https://legal.mistral.ai/terms/data-processing-addendum",
              },
              ".",
            ],
          },
        ],
      },
      {
        id: "email",
        heading: "Contact by e-mail",
        body: [
          {
            type: "paragraph",
            content: [
              "If you contact us by e-mail, your e-mail address, the content of your message and the technical details of the e-mail are processed to answer your request. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is being able to answer requests.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "The mailboxes are hosted by Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australia, as a processor. Data may be transferred to countries outside the EU, in particular Australia, the USA and India. For these transfers, Fastmail uses the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR). Details: ",
              {
                text: "Fastmail privacy policy",
                href: "https://www.fastmail.com/policies/privacy/",
              },
              ", ",
              {
                text: "data processing agreement",
                href: "https://www.fastmail.com/policies/dpa/",
              },
              " and ",
              {
                text: "Standard Contractual Clauses",
                href: "https://www.fastmail.com/policies/dpa/section3/",
              },
              ". You can obtain a copy of the safeguards by writing to ",
              {
                text: operator.privacyEmail,
                href: `mailto:${operator.privacyEmail}`,
              },
              ".",
            ],
          },
          {
            type: "paragraph",
            content: [
              "The controller deletes messages after dealing with the request unless retention remains necessary. Fastmail may subsequently retain backup and log data under its published deletion rules.",
            ],
          },
        ],
      },
      {
        id: "storage",
        heading: "Cookies and local storage",
        body: [
          {
            type: "table",
            headers: ["Name", "Provider", "Purpose", "Duration", "Technical necessity"],
            rows: [
              [
                "NEXT_LOCALE",
                "Controller, paperless-llm.heerlab.com",
                "Stores the selected language (en/de); set only when changing language in Settings.",
                "1 year",
                "Required for the requested language function (Section 25(2) no. 2 TDDDG).",
              ],
              [
                "p_session_token_s.<timestamp>",
                "Pangolin, paperless-llm.heerlab.com",
                "Maintains the SSO session after sign-in; HttpOnly, Secure, SameSite=Lax.",
                "30 days",
                "Required for protected access (Section 25(2) no. 2 TDDDG).",
              ],
            ],
          },
          {
            type: "paragraph",
            content: [
              "The application uses neither localStorage nor sessionStorage nor IndexedDB. The browser loads no external fonts, CDN content or analytics services; application requests use the same-origin /api proxy.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "Pocket-ID sets its own cookies on pocket-id.heerlab.com during sign-in. The four legal information pages themselves set no cookies and load no additional resources.",
            ],
          },
        ],
      },
      {
        id: "rights",
        heading: "Your rights",
        body: [
          {
            type: "paragraph",
            content: ["You have the following rights regarding your personal data:"],
          },
          {
            type: "list",
            items: [
              ["access (Art. 15 GDPR)"],
              ["rectification (Art. 16 GDPR)"],
              ["erasure (Art. 17 GDPR)"],
              ["restriction of processing (Art. 18 GDPR)"],
              ["data portability (Art. 20 GDPR)"],
              [
                "withdrawal of consent (Art. 7(3) GDPR): you may withdraw consent at any time. Withdrawal does not affect the lawfulness of processing before withdrawal.",
              ],
            ],
          },
          {
            type: "paragraph",
            content: [
              {
                strong: "Right to object (Art. 21 GDPR):",
              },
              " Where processing is based on Art. 6(1)(f) GDPR, you may object at any time on grounds relating to your particular situation.",
            ],
          },
          {
            type: "paragraph",
            content: [
              "To exercise your rights, simply send a message to ",
              {
                text: operator.privacyEmail,
                href: `mailto:${operator.privacyEmail}`,
              },
              ".",
            ],
          },
          {
            type: "paragraph",
            content: [
              "You also have the right to lodge a complaint with a data protection supervisory authority, in particular in the member state of your habitual residence, place of work or place of the alleged infringement (Art. 77 GDPR).",
            ],
          },
        ],
      },
      {
        id: "provision",
        heading: "Obligation to provide data",
        body: [
          {
            type: "paragraph",
            content: [
              "You are not obliged to provide personal data. However, the website cannot be delivered without the technically necessary connection data, and the protected areas cannot be used without signing in.",
            ],
          },
        ],
      },
      {
        id: "changes",
        heading: "Changes",
        body: [
          {
            type: "paragraph",
            content: [
              "This privacy policy is updated when the website or the legal situation changes. The version published here applies.",
            ],
          },
        ],
      },
    ],
  },
};
