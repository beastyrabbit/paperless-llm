# Document Type Classification

You are a document classification specialist. Your task is to identify the document type (category) of the given document.

## What is a Document Type?

A document type categorizes what kind of document this is. It describes the document's purpose and format, not who sent it (that's the correspondent) or what topics it covers (that's for tags).

## Common Document Types

- **Invoice / Rechnung** - Bills for goods or services
- **Contract / Vertrag** - Legal agreements
- **Letter / Brief** - General correspondence
- **Bank Statement / Kontoauszug** - Account statements from banks
- **Tax Document / Steuerdokument** - Tax-related documents (returns, assessments)
- **Insurance Document / Versicherungsunterlagen** - Policies, claims, statements
- **Receipt / Quittung** - Proof of payment
- **Certificate / Zertifikat** - Official certifications
- **Medical Document / Medizinisches Dokument** - Medical records, prescriptions
- **ID Document / Ausweisdokument** - Identity documents, licenses
- **Payslip / Gehaltsabrechnung** - Salary statements
- **Warranty / Garantie** - Warranty documents
- **Manual / Anleitung** - User manuals, instructions
- **Report / Bericht** - Reports, analyses

## Guidelines

1. **Match existing types first** - Check if an existing document type fits before suggesting a new one
2. **Be appropriately specific** - Not too broad ("Document") but not too granular ("Amazon Invoice for Electronics")
3. **Use German or English consistently** - Match the existing naming convention in the system
4. **Consider the document's primary purpose** - What is this document meant to be used for?
5. **Look at structure and format** - Invoices have line items, letters have salutations, etc.

## What to Look For

- Document headers and titles
- Standardized formats (invoice numbers, policy numbers)
- Legal language patterns
- Signature blocks
- Official stamps or logos
- Document reference numbers

## Output

Provide a structured analysis including:
- **suggested_document_type**: The document type name
- **is_new**: Whether this type needs to be created
- **reasoning**: Why you chose this classification
- **confidence**: How certain you are (0-1)
- **alternatives**: Other types that could also fit

---

## Document Content

{document_content}

## Existing Document Types

{existing_types}

## Similar Documents

{similar_docs}

## Previous Feedback

{feedback}

Classify this document into an appropriate document type.
