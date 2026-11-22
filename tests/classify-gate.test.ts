import { afterEach, describe, expect, it } from "vitest";
import type { OpenField } from "../src/config/index.js";
import { enqueue, getJob } from "../src/db/store.js";
import type { Candidate } from "../src/pipeline/context.js";
import { gate, groundedWindow, parseDate, parseMoney } from "../src/pipeline/gate.js";
import { classify, templateTitle } from "../src/pipeline/layer2Classify.js";
import { extract } from "../src/pipeline/layer3Extract.js";
import { exactKeys, NONE, normalize, shortlist, UNRESOLVED } from "../src/pipeline/shortlist.js";
import { metadata } from "../src/pipeline/worker.js";
import { id, now } from "../src/util.js";
import { document, Fixture } from "./helpers.js";

let fixture: Fixture;
afterEach(() => fixture?.close());
const open = (name: string, kind: OpenField["kind"], semanticCheck = false): OpenField => ({
  name,
  kind,
  required: true,
  semanticCheck,
});
describe("shortlists and Layer 2", () => {
  it("extracts checksum-valid IBANs without swallowing a following BIC", () => {
    expect(exactKeys("Straße 1\nIBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX").iban).toEqual([
      "de89370400440532013000",
    ]);
    expect(exactKeys("CR05 0152 0200 1026 2840 66 BIC TESTBANK").iban).toEqual([
      "cr05015202001026284066",
    ]);
    expect(exactKeys("IBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX").iban).toEqual([
      "de89370400440532013000",
    ]);
    expect(exactKeys("DE88 3704 0044 0532 0130 00 BIC COBADEFFXXX").iban).toEqual([]);
    expect(
      exactKeys("AT61 1904 3002 3457 3201; CH93 0076 2011 6238 5295 7; GB82 WEST 1234 5698 7654 32")
        .iban,
    ).toEqual(["at611904300234573201", "ch9300762011623852957", "gb82west12345698765432"]);
    expect(exactKeys("NL91 ABNA 0417 1643 00; FR14 2004 1010 0505 0001 3M02 606").iban).toEqual([
      "nl91abna0417164300",
      "fr1420041010050500013m02606",
    ]);
  });
  it("matches aliases as whole words rather than inside other words", () => {
    fixture = new Fixture();
    fixture.db
      .prepare(
        "INSERT INTO aliases(id,entity_kind,canonical_id,canonical_name,alias_text,normalized_alias,key_kind,created_at) VALUES(?,'correspondent',2,'Bank','ing','ing','name',?)",
      )
      .run(id(), now());
    const entities = [
      { id: 1, name: "Leasing" },
      { id: 2, name: "Bank" },
    ];
    expect(shortlist(fixture.db, "leasing", entities, "correspondent", 1).entities[0]?.id).toBe(1);
    expect(shortlist(fixture.db, "ING account", entities, "correspondent", 1).entities[0]?.id).toBe(
      2,
    );
  });
  it("limits generated template titles to the Paperless maximum", () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = {
        titleTemplate: "x".repeat(200),
        openFields: [],
        selectFields: [],
      };
    });
    expect(String(templateTitle(fixture.ctx, [], document(), "Invoice")?.value)).toHaveLength(128);
  });
  it("prioritizes exact aliases and domains before lexical/trigram ranking", () => {
    fixture = new Fixture();
    fixture.db
      .prepare(
        "INSERT INTO aliases(id,entity_kind,canonical_id,canonical_name,alias_text,normalized_alias,key_kind,created_at) VALUES(?,'correspondent',2,'Other','acme.test','acme.test','domain',?)",
      )
      .run(id(), now());
    const result = shortlist(
      fixture.db,
      "Acme GmbH\nbilling@acme.test",
      [
        { id: 1, name: "Acme GmbH" },
        { id: 2, name: "Other" },
        { id: 3, name: "Unrelated" },
      ],
      "correspondent",
      1,
    );
    expect(result.entities[0]?.id).toBe(2);
    expect(Object.keys(result.criteria)).toEqual(["2", NONE, UNRESOLVED]);
    expect(normalize("Müller GmbH")).toBe(normalize("Mueller AG"));
    expect(() => shortlist(fixture.db, "", [], "tag", 254)).toThrow();
  });
  it("limits total choices to 255 with both sentinels", () => {
    fixture = new Fixture();
    const result = shortlist(
      fixture.db,
      "Acme",
      Array.from({ length: 500 }, (_, index) => ({ id: index + 1, name: `Entity ${index}` })),
      "correspondent",
      253,
    );
    expect(Object.keys(result.criteria)).toHaveLength(255);
  });
  it("takes the L2-only path and deterministic title without an L3 call", async () => {
    fixture = new Fixture((config) => {
      config.ocr.enabled = false;
      config.documentTypes.Invoice = {
        titleTemplate: "{correspondent} {created}",
        openFields: [],
        selectFields: [],
      };
    });
    const doc = fixture.docs.get(1);
    if (!doc) throw new Error("fixture");
    const result = await classify(fixture.ctx, doc, fixture.catalog);
    expect(result.needsL3).toBe(false);
    expect(result.fields.find((field) => field.field === "title")?.value).toBe(
      "Acme GmbH 2026-11-21",
    );
    const job = enqueue(fixture.db, 1, "metadata", "test", fixture.ctx.configHash);
    await metadata(fixture.ctx, job);
    expect(fixture.docs.get(1)?.title).toBe("Acme GmbH 2026-11-21");
    expect(fixture.providerCalls("cloud.test")).toHaveLength(0);
    expect(getJob(fixture.db, job.id)?.usage_json).toContain('"provider":"jev"');
    expect(fixture.docs.get(1)?.tags).toEqual([99]);
  });
  it("classifies curated tags and applicable boolean/select fields", async () => {
    fixture = new Fixture((config) => {
      config.tags.curated = { finance: "Financial documents" };
      config.documentTypes.Invoice = {
        openFields: [open("paid", "boolean"), open("category", "select")],
        selectFields: [],
      };
    });
    const result = await classify(fixture.ctx, document(), fixture.catalog);
    expect(result.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "tag:finance", value: true, passed: true }),
        expect.objectContaining({ field: "custom:paid", value: true, passed: true }),
        expect.objectContaining({ field: "custom:category", value: "option-a", passed: true }),
      ]),
    );
    expect(result.needsL3).toBe(false);
  });
  it("requires L3 for unresolved picks and required open fields", async () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = { openFields: [open("total", "monetary")], selectFields: [] };
    });
    expect((await classify(fixture.ctx, document(), fixture.catalog)).needsL3).toBe(true);
    fixture.jev = () => ({
      type: "choice",
      choice: UNRESOLVED,
      confidence: 0.99,
      probabilities: { [UNRESOLVED]: 1 },
    });
    expect(
      (await classify(fixture.ctx, document(), fixture.catalog)).fields.every(
        (field) => !field.passed,
      ),
    ).toBe(true);
  });
});
describe("bounded gate", () => {
  it.each([
    ["9999.00", "Rechnung", false],
    ["1.234,56 EUR", "Gesamtbetrag: 1.234,56 €", true],
    ["1234.00", "Gesamtbetrag: 1.234 €", true],
    ["1234.56", "Total: 1,234.56 USD", true],
    ["1234.56", "Total: 91234.56 USD", false],
  ])("checks that monetary value %s is supported by quote %s", async (value, quote, passed) => {
    fixture = new Fixture();
    const result = await gate(
      fixture.ctx,
      quote,
      [{ field: "custom:total", value, evidenceQuote: quote, confidence: 1 }],
      [],
      fixture.catalog,
      [open("total", "monetary")],
    );
    expect(result[0]).toMatchObject({ passed, checks: { grounded: true, valueInQuote: passed } });
  });
  it.each([
    ["date", "2026-01-02", "Datum 2.1.2026", true],
    ["date", "2026-01-02", "Datum 2026-01-02", true],
    ["date", "2026-01-02", "Datum 3.1.2026", false],
    ["string", "Invoice 123", "INVOICE\n   123", true],
    ["string", "Invoice 123", "Invoice 124", false],
    ["integer", 1234, "Anzahl 1.234", true],
    ["float", 1234.5, "Wert 1.234,5", true],
    ["float", 1234.5, "Wert 1,234.5", true],
    ["integer", 1234, "Anzahl 91234", false],
  ] as const)("grounds %s values against the quote", async (kind, value, quote, passed) => {
    fixture = new Fixture();
    const result = await gate(
      fixture.ctx,
      quote,
      [{ field: "custom:invoice_number", value, evidenceQuote: quote, confidence: 1 }],
      [],
      fixture.catalog,
      [open("invoice_number", kind)],
    );
    expect(result[0]).toMatchObject({ passed, checks: { valueInQuote: passed } });
  });
  it.each([
    null,
    "not_applicable",
  ])("keeps missing entity answers unresolved: %s", async (value) => {
    fixture = new Fixture();
    const result = await gate(
      fixture.ctx,
      "",
      ["tag:finance", "correspondent", "document_type"].map((field) => ({
        field,
        value,
        evidenceQuote: null,
        confidence: 1,
      })),
      [],
      fixture.catalog,
      [],
    );
    expect(
      result.every((candidate) => !candidate.passed && candidate.checks?.typeValid === false),
    ).toBe(true);
    expect(result[0]?.checks?.tagId).toBe(20);
  });
  it("keeps document type unresolved when L3 returns null", async () => {
    fixture = new Fixture();
    const result = await gate(
      fixture.ctx,
      "source",
      [{ field: "document_type", value: null, evidenceQuote: null, confidence: 1 }],
      [],
      fixture.catalog,
      [],
    );
    expect(result[0]?.passed).toBe(false);
    expect(result[0]?.checks?.typeValid).toBe(false);
  });
  it.each([
    ["21.11.2026", "2026-11-21"],
    ["2024-02-29", "2024-02-29"],
    ["31.02.2026", null],
    ["11/21/2026", null],
  ])("validates date %s", (input, expected) => expect(parseDate(input)).toBe(expected));
  it.each([
    ["1.234,56 EUR", "1234.56"],
    ["142.80", "142.80"],
    ["1,234.56 USD", "1234.56"],
    ["-42,50 €", "-42.50"],
    ["12oops", null],
    ["1,234", null],
  ])("validates money %s", (input, expected) => expect(parseMoney(input)).toBe(expected));
  it("grounds normalized whitespace but sends only a raw OCR window to the selective noul check", async () => {
    fixture = new Fixture();
    const ocr = "Header\nAcme   GmbH\nTotal 1.234,56 EUR\nFooter";
    const response = await gate(
      fixture.ctx,
      ocr,
      [
        {
          field: "correspondent",
          value: 1,
          evidenceQuote: "Acme GmbH",
          confidence: 0.99,
        },
        {
          field: "custom:total",
          value: "1.234,56 EUR",
          evidenceQuote: "Total 1.234,56 EUR",
          confidence: 0.99,
        },
      ],
      [{ field: "correspondent", value: null, passed: false, confidence: 0.5 }],
      fixture.catalog,
      [open("total", "monetary", true)],
    );
    expect(response.every((field) => field.passed)).toBe(true);
    expect(response[1]?.value).toBe("1234.56");
    expect(fixture.providerCalls("jev.test")).toHaveLength(2);
    for (const call of fixture.providerCalls("jev.test")) {
      const request = call.body as { state: string };
      expect(request.state).toBe(ocr);
      expect(JSON.stringify(request)).not.toContain("rationale");
    }
    expect(groundedWindow(ocr, "invented rationale")).toBeNull();
  });
  it("does not send ungrounded values to Jev and does not recheck unchanged L2 picks", async () => {
    fixture = new Fixture();
    const previous: Candidate[] = [
      { field: "correspondent", value: 1, passed: true, confidence: 0.99 },
    ];
    const result = await gate(
      fixture.ctx,
      "Acme GmbH",
      [
        { field: "correspondent", value: 1, evidenceQuote: "Acme GmbH", confidence: 0.9 },
        { field: "custom:total", value: "12.00", evidenceQuote: "not present", confidence: 1 },
      ],
      previous,
      fixture.catalog,
      [open("total", "monetary", true)],
    );
    expect(result.map((field) => field.passed)).toEqual([true, false]);
    expect(fixture.providerCalls("jev.test")).toHaveLength(0);
  });
  it("maps select labels, enforces 128 characters, and rejects invalid types", async () => {
    fixture = new Fixture();
    const fields = [
      { field: "custom:category", value: "A", evidenceQuote: "A", confidence: 1 },
      { field: "custom:invoice_number", value: "x".repeat(129), evidenceQuote: "A", confidence: 1 },
      { field: "custom:paid", value: "yes", evidenceQuote: "A", confidence: 1 },
    ];
    const result = await gate(fixture.ctx, "A", fields, [], fixture.catalog, [
      open("category", "select"),
      open("invoice_number", "string"),
      open("paid", "boolean"),
    ]);
    expect(result[0]).toMatchObject({ value: "option-a", passed: true });
    expect(result.slice(1).every((field) => !field.passed)).toBe(true);
  });
  it("deduplicates proposed names against normalized catalogs and aliases", async () => {
    fixture = new Fixture();
    const result = await gate(
      fixture.ctx,
      "Acme AG",
      [
        {
          field: "correspondent",
          value: "Acme AG",
          newEntity: { kind: "correspondent", name: "Acme AG" },
          evidenceQuote: "Acme AG",
          confidence: 0.99,
        },
      ],
      [],
      fixture.catalog,
      [],
    );
    expect(result[0]).toMatchObject({ value: 1, passed: true, checks: { deduplicated: true } });
    expect(result[0]?.newEntity).toBeUndefined();
  });
  it("rejects mismatched entity kinds and unsupported custom fields", async () => {
    fixture = new Fixture();
    const result = await gate(
      fixture.ctx,
      "Invoice",
      [
        {
          field: "correspondent",
          value: "Invoice",
          evidenceQuote: "Invoice",
          confidence: 1,
          newEntity: { kind: "tag", name: "Invoice" },
        },
        { field: "custom:unknown", value: "Invoice", evidenceQuote: "Invoice", confidence: 1 },
      ],
      [],
      fixture.catalog,
      [],
    );
    expect(result.every((field) => !field.passed)).toBe(true);
  });
});
describe("Layer 3 request boundary", () => {
  it("includes only applicable fields and rejects extra/duplicate extraction fields", async () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = { openFields: [open("total", "monetary")], selectFields: [] };
    });
    const classification = await classify(fixture.ctx, document(), fixture.catalog);
    fixture.completions = [
      JSON.stringify({
        fields: [{ field: "custom:other", value: "x", evidenceQuote: "x", confidence: 1 }],
      }),
    ];
    await expect(extract(fixture.ctx, document(), classification, fixture.catalog)).rejects.toThrow(
      "unexpected",
    );
    const request = fixture.providerCalls("cloud.test")[0]?.body as {
      messages: { content: string }[];
    };
    const payload = JSON.parse(request.messages[1]?.content ?? "{}");
    expect(payload.openFields.map((field: OpenField) => field.name)).toEqual(["total"]);
  });
  it("honours document-type routing none", async () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = {
        llmRouting: "none",
        openFields: [open("total", "monetary")],
        selectFields: [],
      };
    });
    const classification = await classify(fixture.ctx, document(), fixture.catalog);
    expect(await extract(fixture.ctx, document(), classification, fixture.catalog)).toEqual([]);
    expect(fixture.providerCalls("cloud.test")).toHaveLength(0);
  });
});
