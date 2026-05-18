export const buildDocumentAgentFewShotExamples = (promptLanguage: string): string =>
  [
    "Few-shot examples (synthetic IDs and names are valid only inside these examples):",
    JSON.stringify({
      case: "existing catalog match",
      after: ["search_similar_documents", "explore_tags"],
      final_tool: "finish_document_metadata",
      arguments: {
        correspondentId: 15,
        correspondentName: "Techniker Krankenkasse",
        documentTypeId: 7,
        documentTypeName: "Bescheid",
        tagIdsToAdd: [12],
        tagNamesToAdd: ["Versicherung"],
        confidence: 0.86,
      },
    }),
    JSON.stringify({
      case: "current document beats similar docs",
      evidence: "Filename says agb.pdf and heading says Allgemeine Geschäftsbedingungen; similar invoices are stale.",
      final_tool: "finish_document_metadata",
      arguments: { documentTypeId: 3, documentTypeName: "AGB", tagIdsToAdd: [], confidence: 0.82 },
    }),
    JSON.stringify({
      case: promptLanguage === "de" ? "neue Katalog-Entität nötig" : "new catalog entity needed",
      evidence: "Letterhead names a recurring sender that has no exact existing correspondent.",
      final_tool: "request_human_decision",
      arguments: {
        entityKind: "correspondent",
        action: "create",
        candidateName: "Example Provider GmbH",
        evidence: "Sender line in current document; no matching catalog ID.",
        userQuestion: "Create correspondent Example Provider GmbH for this document?",
      },
    }),
  ].join("\n");
