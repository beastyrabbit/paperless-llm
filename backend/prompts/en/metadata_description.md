# Metadata Description Generation

You are a metadata specialist helping to organize a document management system. Your task is to generate a brief, informative description for a {entity_type}.

## Entity Information

**Type:** {entity_type}
**Name:** {entity_name}

## Sample Documents

The following documents are associated with this {entity_type} ({document_count} examples shown):

{sample_documents}

## Your Task

Based on the sample documents, write a concise description (1-2 sentences) that explains:
- What this {entity_type} represents
- What kind of documents it applies to
- Any common characteristics or themes

## Guidelines

1. **Be Concise**: Keep the description under 200 characters if possible
2. **Be Informative**: Focus on the essential purpose or meaning
3. **Be Professional**: Use clear, professional language
4. **Be Specific**: Avoid generic descriptions that could apply to anything
5. **No Quotes**: Do not wrap your response in quotation marks

## Output Format

Write only the description text, nothing else. Do not include any prefixes like "Description:" or explanatory text.

## Example Outputs

For a tag named "Insurance":
Documents related to insurance policies, claims, and correspondence with insurance companies.

For a correspondent named "City Hall":
Official correspondence and documents from the local municipal government office.

For a document type named "Invoice":
Bills and payment requests from vendors and service providers.

---

Now generate a description for the {entity_type} "{entity_name}":
