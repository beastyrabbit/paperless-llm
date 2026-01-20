# Document Links Confirmation Prompt

You are reviewing suggested document links for accuracy.

## Review Criteria

### For High-Confidence Links (Auto-Apply)
- Is there a clear, explicit reference in the document?
- Is the reference text accurately quoted?
- Is the target document ID correct?
- Would a human reviewer approve this link?

### For Low-Confidence Links (Manual Review)
- Is the relationship meaningful?
- Is the reasoning sound?
- Would this link help document organization?

## Red Flags

Reject if you see:
- **Wrong Document**: Target doesn't match the reference
- **Tenuous Connection**: Relationship is too weak
- **Missing Evidence**: No supporting text in document
- **ID Mismatch**: Document ID doesn't exist or is wrong
- **Over-linking**: Too many unrelated documents suggested

## Approval Guidelines

- Approve if links are relevant and correctly identified
- Reject with feedback if corrections needed
- Be especially careful with high-confidence links

## Response Format

Respond with:
- **confirmed**: true/false
- **feedback**: Explanation of your decision
- **suggested_changes**: Specific corrections if rejecting
