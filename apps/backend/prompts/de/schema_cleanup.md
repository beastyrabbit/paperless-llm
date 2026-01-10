# Schema-Bereinigung Analyse

Du analysierst zwei {entity_type} Eintraege, um festzustellen, ob sie zu einem einzelnen Eintrag zusammengefuehrt werden sollten.

## Zu vergleichende Eintraege

**Eintrag 1:** {name1}
- Wird von {doc_count_1} Dokumenten verwendet

**Eintrag 2:** {name2}
- Wird von {doc_count_2} Dokumenten verwendet

## Entscheidungskriterien

### Wann ZUSAMMENFUEHREN (should_merge: true)

Fuehre diese Eintraege zusammen, wenn sie **dieselbe Entitaet** mit unterschiedlicher:
- **Grossschreibung** darstellen: "AMAZON" vs "Amazon" vs "amazon"
- **Rechtsform-Zusaetze**: "Firma GmbH" vs "Firma" vs "Firma Inc."
- **Regionale Zusaetze**: "Amazon" vs "Amazon.de" vs "Amazon EU"
- **Leerzeichen/Satzzeichen**: "Dr. Schmidt" vs "Dr Schmidt" vs "Dr.Schmidt"
- **Offensichtliche Tippfehler**: "Amazn" vs "Amazon"
- **Einzahl/Mehrzahl** (fuer Tags): "Rechnung" vs "Rechnungen"
- **Abkuerzungen**: "Dt. Bank" vs "Deutsche Bank"

### Wann NICHT zusammenfuehren (should_merge: false)

NICHT zusammenfuehren, wenn es **wirklich unterschiedliche Entitaeten** sind:
- **Verschiedene Unternehmen**: "Amazon" vs "Amazon Web Services" (verschiedene Dienste)
- **Verschiedene Standorte**: "Finanzamt Berlin" vs "Finanzamt Muenchen"
- **Verschiedene Personen**: "Dr. M. Schmidt" vs "Dr. K. Schmidt"
- **Verschiedene Kategorien**: "Rechnung" vs "Rechnungsvorlage"
- **Absichtlich getrennt**: Benutzer hat moeglicherweise absichtlich separate Eintraege erstellt

## Ausgabeanforderungen

1. **should_merge**: `true` wenn zusammengefuehrt werden soll, `false` wenn getrennt bleiben soll
2. **reasoning**: Klare Erklaerung deiner Entscheidung (2-3 Saetze)
3. **keep_name**: Wenn zusammengefuehrt wird, welcher Name behalten werden soll (bevorzuge den:
   - Vollstaendigeren/formelleren Namen
   - Haeufiger verwendete Variante
   - Eintrag mit mehr Dokumenten)

## Beispiele

### Sollten zusammengefuehrt werden
- "Deutsche Bank AG" + "Deutsche Bank" -> Behalte "Deutsche Bank"
- "amazon" + "Amazon" -> Behalte "Amazon"
- "Dr Mueller" + "Dr. Mueller" -> Behalte "Dr. Mueller"

### Sollten NICHT zusammengefuehrt werden
- "Amazon" + "Amazon Fresh" -> Verschiedene Dienste
- "Finanzamt Berlin" + "Finanzamt Muenchen" -> Verschiedene Aemter
- "Vertrag" + "Vertragsvorlage" -> Verschiedene Dokumentzwecke
