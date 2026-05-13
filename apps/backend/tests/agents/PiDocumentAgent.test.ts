import { describe, expect, it } from "vitest";
import {
  normalizeFinishMetadataArguments,
  parseFieldAssignmentsJson,
  redactSensitiveMetadataText,
} from "../../src/agents/PiDocumentAgent.js";

describe("parseFieldAssignmentsJson", () => {
  it("keeps object maps for existing field assignment format", () => {
    expect(parseFieldAssignmentsJson('{"1":"INV-1","35":"455563201"}')).toEqual({
      "1": "INV-1",
      "35": "455563201",
    });
  });

  it("normalizes array-shaped custom field assignments emitted by Pi tools", () => {
    expect(
      parseFieldAssignmentsJson(
        '[{"custom_field_id":1,"value":"INV-1"},{"field":35,"value":"455563201"},{"id":"38","value":44.98}]',
      ),
    ).toEqual({
      "1": "INV-1",
      "35": "455563201",
      "38": 44.98,
    });
  });

  it("supports array-shaped document link assignments", () => {
    expect(
      parseFieldAssignmentsJson('[{"field":12,"document_ids":[674,521]}]', {
        valueKeys: ["value", "document_ids"],
      }),
    ).toEqual({
      "12": [674, 521],
    });
  });
});

describe("normalizeFinishMetadataArguments", () => {
  it("normalizes common Pi alias fields for final metadata calls", () => {
    expect(
      normalizeFinishMetadataArguments({
        correspondent: "15",
        documentType: "52",
        custom_fieldsJson: { 36: "Techniker Krankenkasse" },
        documentLinksJson: [{ field: 39, document_ids: [281, 283] }],
        tagIdsToRemove: ["106"],
      }),
    ).toMatchObject({
      correspondentId: 15,
      documentTypeId: 52,
      customFieldsJson: '{"36":"Techniker Krankenkasse"}',
      linkedDocumentsJson: '[{"field":39,"document_ids":[281,283]}]',
      tagIdsToRemove: [106],
    });
  });
});

describe("redactSensitiveMetadataText", () => {
  it("does not match pin or tan inside unrelated words", () => {
    expect(redactSensitiveMetadataText("Spinning Studio INVOICE2024")).toBe(
      "Spinning Studio INVOICE2024",
    );
    expect(redactSensitiveMetadataText("Kontostand REF202405")).toBe("Kontostand REF202405");
  });

  it("redacts uppercase codes when standalone pin or tan keywords are present", () => {
    expect(redactSensitiveMetadataText("PIN ABCDEF123")).toBe("PIN [redacted]");
    expect(redactSensitiveMetadataText("TAN ZXCVBN987")).toBe("TAN [redacted]");
  });
});
