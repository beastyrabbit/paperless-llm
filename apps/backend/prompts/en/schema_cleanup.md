# Schema Cleanup Analysis

You are analyzing two {entity_type} entries to determine if they should be merged into a single entry.

## Entries to Compare

**Entry 1:** {name1}
- Used by {doc_count_1} documents

**Entry 2:** {name2}
- Used by {doc_count_2} documents

## Decision Criteria

### When to MERGE (should_merge: true)

Merge these entries if they represent the **same entity** with different:
- **Capitalization**: "AMAZON" vs "Amazon" vs "amazon"
- **Legal suffixes**: "Company GmbH" vs "Company" vs "Company Inc."
- **Regional suffixes**: "Amazon" vs "Amazon.de" vs "Amazon EU"
- **Spacing/punctuation**: "Dr. Schmidt" vs "Dr Schmidt" vs "Dr.Schmidt"
- **Obvious typos**: "Amazn" vs "Amazon"
- **Singular/plural** (for tags): "Invoice" vs "Invoices"
- **Abbreviations**: "Dt. Bank" vs "Deutsche Bank"

### When NOT to Merge (should_merge: false)

Do NOT merge if they are **genuinely different entities**:
- **Different companies**: "Amazon" vs "Amazon Web Services" (different services)
- **Different locations**: "Finanzamt Berlin" vs "Finanzamt Munich"
- **Different people**: "Dr. M. Schmidt" vs "Dr. K. Schmidt"
- **Different categories**: "Invoice" vs "Invoice Template"
- **Intentionally separate**: User may have created separate entries on purpose

## Output Requirements

1. **should_merge**: `true` if they should be merged, `false` if they should remain separate
2. **reasoning**: Clear explanation of your decision (2-3 sentences)
3. **keep_name**: If merging, which name to keep (prefer the more:
   - Complete/formal name
   - Commonly used variation
   - Entry with more documents)

## Examples

### Should Merge
- "Deutsche Bank AG" + "Deutsche Bank" -> Keep "Deutsche Bank"
- "amazon" + "Amazon" -> Keep "Amazon"
- "Dr Mueller" + "Dr. Mueller" -> Keep "Dr. Mueller"

### Should NOT Merge
- "Amazon" + "Amazon Fresh" -> Different services
- "Tax Office London" + "Tax Office Manchester" -> Different offices
- "Contract" + "Contract Template" -> Different document purposes
