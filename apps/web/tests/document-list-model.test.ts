import { describe, expect, it } from "vitest";
import {
  documentDetailToSummary,
  filterDocuments,
  getNumericSearchId,
} from "../components/documents/document-list-model";
import type { DocumentDetail, DocumentSummary } from "../lib/api";

const documents: DocumentSummary[] = [
  {
    id: 10,
    title: "Tax notice",
    correspondent: "Revenue Office",
    created: "2026-05-15",
    tags: ["ai-needs-input"],
    processing_status: "review",
  },
  {
    id: 11,
    title: "Vendor invoice",
    correspondent: "Example Corp",
    created: "2026-05-14",
    tags: ["ai-done"],
    processing_status: "done",
  },
];

const tagMap = {
  review: "ai-needs-input",
  done: "ai-done",
};

describe("document list model", () => {
  it("normalizes positive numeric searches only", () => {
    expect(getNumericSearchId("42")).toBe(42);
    expect(getNumericSearchId(" 42 ")).toBe(42);
    expect(getNumericSearchId("0")).toBeNull();
    expect(getNumericSearchId("-1")).toBeNull();
    expect(getNumericSearchId("1.5")).toBeNull();
    expect(getNumericSearchId(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(getNumericSearchId(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
    expect(getNumericSearchId("invoice")).toBeNull();
  });

  it("searches the full loaded queue and ignores the active status filter", () => {
    expect(
      filterDocuments(documents, {
        statusFilter: "review",
        search: "vendor",
        tagMap,
        directDocument: null,
      }).map((document) => document.id),
    ).toEqual([11]);
  });

  it("prepends a direct numeric result when it is outside the loaded queue", () => {
    const directDocument = { ...documents[1], id: 99, title: "Archive hit" };

    expect(
      filterDocuments(documents, {
        statusFilter: "review",
        search: "99",
        tagMap,
        directDocument,
      }).map((document) => document.id),
    ).toEqual([99]);
  });

  it("normalizes document detail tag objects into list tag names", () => {
    const detail = {
      id: 12,
      title: "Detail",
      correspondent: null,
      correspondent_id: null,
      document_type: null,
      document_type_id: null,
      created: "2026-05-15",
      modified: "2026-05-15",
      added: "2026-05-15",
      tags: [{ id: 1, name: "ai-done" }],
      processing_status: "done",
      custom_fields: [],
      content: null,
      original_file_name: null,
      archive_serial_number: null,
    } satisfies DocumentDetail;

    expect(documentDetailToSummary(detail)).toMatchObject({
      id: 12,
      tags: ["ai-done"],
      processing_status: "done",
    });
  });
});
