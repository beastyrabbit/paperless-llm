import { afterEach, describe, expect, it } from "vitest";
import type { Change, Proposal } from "../src/db/store.js";
import {
  applyCandidates,
  approveReview,
  rejectReview,
  resolveProposal,
} from "../src/pipeline/apply.js";
import type { Candidate } from "../src/pipeline/context.js";
import { document, Fixture } from "./helpers.js";

let fixture: Fixture;
afterEach(() => fixture?.close());
const type: Candidate = { field: "document_type", value: 2, passed: true, confidence: 0.99 };
const correspondent: Candidate = {
  field: "correspondent",
  value: 1,
  passed: true,
  confidence: 0.99,
};
const staged = () =>
  fixture.db.prepare("SELECT * FROM changes WHERE status='staged'").all() as Change[];
describe("dependency-aware apply", () => {
  it("holds every field when document type is unresolved", async () => {
    fixture = new Fixture();
    await applyCandidates(fixture.ctx, 1, [{ ...type, passed: false }, correspondent]);
    expect(fixture.docs.get(1)?.correspondent).toBeNull();
    expect(staged()).toHaveLength(2);
    expect(fixture.docs.get(1)?.tags).toEqual([99, 11]);
  });
  it("applies passing independent fields in one PATCH and stages failures", async () => {
    fixture = new Fixture();
    const result = await applyCandidates(fixture.ctx, 1, [
      type,
      correspondent,
      {
        field: "custom:total",
        value: "12.00",
        confidence: 0.4,
        passed: false,
        checks: { customFieldId: 101 },
      },
    ]);
    expect(result.staged).toBe(1);
    expect(fixture.docs.get(1)).toMatchObject({ document_type: 2, correspondent: 1 });
    const patches = fixture.calls.filter(
      (call) => call.method === "PATCH" && call.url.pathname === "/api/documents/1/",
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ document_type: 2, correspondent: 1 });
    expect(fixture.docs.get(1)?.tags).toContain(99);
  });
  it("holds template titles while any input remains staged", async () => {
    fixture = new Fixture();
    await applyCandidates(fixture.ctx, 1, [
      type,
      { ...correspondent, passed: false },
      {
        field: "title",
        value: "Acme Invoice",
        confidence: 1,
        passed: true,
        templateInputs: ["correspondent"],
      },
    ]);
    expect(fixture.docs.get(1)?.title).toBe("");
    expect(staged().map((change) => change.field_name)).toContain("title");
  });
  it("stages the whole document in document staging mode", async () => {
    fixture = new Fixture((config) => {
      config.stagingMode = "document";
    });
    await applyCandidates(fixture.ctx, 1, [type, { ...correspondent, passed: false }]);
    expect(fixture.docs.get(1)?.document_type).toBeNull();
  });
  it("preserves human fields after DB loss and after a recorded service write", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { title: "Human title" }));
    await applyCandidates(fixture.ctx, 1, [
      type,
      correspondent,
      { field: "title", value: "AI title", confidence: 1, passed: true },
    ]);
    expect(fixture.docs.get(1)?.title).toBe("Human title");
    const doc = fixture.docs.get(1);
    if (doc) doc.correspondent = 42;
    await applyCandidates(fixture.ctx, 1, [type, correspondent]);
    expect(fixture.docs.get(1)?.correspondent).toBe(42);
  });
  it("can update a field previously written and verified by the service", async () => {
    fixture = new Fixture();
    await applyCandidates(fixture.ctx, 1, [
      type,
      { field: "title", value: "First", confidence: 1, passed: true },
    ]);
    await applyCandidates(fixture.ctx, 1, [
      type,
      { field: "title", value: "Second", confidence: 1, passed: true },
    ]);
    expect(fixture.docs.get(1)?.title).toBe("Second");
  });
  it("preserves unrelated custom fields in the combined metadata patch", async () => {
    fixture = new Fixture();
    const doc = fixture.docs.get(1);
    if (doc) doc.custom_fields = [{ field: 999, value: "private-human-field" }];
    await applyCandidates(fixture.ctx, 1, [
      type,
      {
        field: "custom:total",
        value: "1234.56",
        passed: true,
        confidence: 1,
        checks: { customFieldId: 101 },
      },
    ]);
    expect(doc?.custom_fields).toEqual([
      { field: 999, value: "private-human-field" },
      { field: 101, value: "1234.56" },
    ]);
  });
  it("read-back detects unapplied writes and retains review", async () => {
    fixture = new Fixture();
    fixture.fail = (_url, init) =>
      init.method === "PATCH"
        ? new Response(JSON.stringify(document()), {
            headers: { "Content-Type": "application/json" },
          })
        : undefined;
    const result = await applyCandidates(fixture.ctx, 1, [type]);
    expect(result.conflicts).toHaveLength(1);
    expect(fixture.docs.get(1)?.tags).toContain(11);
  });
});
describe("review and shared entity proposals", () => {
  it("rejects read-back verification failures so they leave the review queue", async () => {
    fixture = new Fixture();
    fixture.fail = (_url, init) =>
      init.method === "PATCH"
        ? new Response(JSON.stringify(document()), {
            headers: { "Content-Type": "application/json" },
          })
        : undefined;
    await applyCandidates(fixture.ctx, 1, [type]);
    expect(fixture.db.prepare("SELECT status FROM changes").get()).toEqual({ status: "failed" });
    await rejectReview(fixture.ctx, 1);
    expect(fixture.db.prepare("SELECT status FROM changes").get()).toEqual({ status: "rejected" });
    expect(fixture.docs.get(1)?.tags).toEqual([99]);
  });
  it("recomputes a withheld title after its correspondent and date are approved", async () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = {
        titleTemplate: "{correspondent} {invoice_date}",
        openFields: [],
        selectFields: [],
      };
    });
    await applyCandidates(fixture.ctx, 1, [
      type,
      { ...correspondent, passed: false },
      {
        field: "custom:invoice_date",
        value: "2026-11-21",
        passed: false,
        confidence: 0.5,
        checks: { customFieldId: 102 },
      },
      {
        field: "title",
        value: null,
        passed: false,
        confidence: 0,
        templateInputs: ["correspondent", "invoice_date"],
      },
    ]);
    const inputs = staged()
      .filter((change) => change.field_name !== "title")
      .map((change) => change.id);
    await approveReview(fixture.ctx, 1, inputs);
    expect(fixture.docs.get(1)?.title).toBe("Acme GmbH 2026-11-21");
    expect(staged()).toHaveLength(0);
  });
  it("recomputes withheld titles when a correspondent proposal is mapped", async () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = {
        titleTemplate: "{correspondent} {created}",
        openFields: [],
        selectFields: [],
      };
    });
    await applyCandidates(fixture.ctx, 1, [
      type,
      {
        ...correspondent,
        value: "Alias",
        passed: false,
        newEntity: { kind: "correspondent", name: "Alias" },
      },
      {
        field: "title",
        value: null,
        passed: false,
        confidence: 0,
        templateInputs: ["correspondent", "created"],
      },
    ]);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    await resolveProposal(fixture.ctx, proposal.id, "map", 1);
    expect(fixture.docs.get(1)?.title).toBe("Acme GmbH 2026-11-21");
    expect(staged()).toHaveLength(0);
  });
  it("keeps a withheld title while inputs remain unresolved or the title is human-owned", async () => {
    fixture = new Fixture((config) => {
      config.documentTypes.Invoice = {
        titleTemplate: "{correspondent} {invoice_date}",
        openFields: [],
        selectFields: [],
      };
    });
    fixture.docs.set(1, document(1, { title: "Human title" }));
    await applyCandidates(fixture.ctx, 1, [
      type,
      { ...correspondent, passed: false },
      {
        field: "custom:invoice_date",
        value: "2026-11-21",
        passed: false,
        confidence: 0.5,
        checks: { customFieldId: 102 },
      },
      {
        field: "title",
        value: null,
        passed: false,
        confidence: 0,
        templateInputs: ["correspondent", "invoice_date"],
      },
    ]);
    const date = staged().find((change) => change.field_name === "custom:invoice_date");
    await approveReview(fixture.ctx, 1, date ? [date.id] : []);
    expect(fixture.docs.get(1)?.title).toBe("Human title");
    await approveReview(fixture.ctx, 1);
    expect(fixture.docs.get(1)?.title).toBe("Human title");
    const pendingTitle = staged();
    expect(pendingTitle.map((change) => change.field_name)).toEqual(["title"]);
    expect(JSON.parse(pendingTitle[0]?.proposed_value_json ?? "null")).toBe("Acme GmbH 2026-11-21");
    expect(JSON.parse(pendingTitle[0]?.check_results_json ?? "{}")).toMatchObject({
      humanConflict: true,
      dependencyBlocked: false,
      candidatePassed: true,
    });
    // Operator can now explicitly approve the recomputed title to replace the human-owned title.
    await approveReview(fixture.ctx, 1);
    expect(fixture.docs.get(1)?.title).toBe("Acme GmbH 2026-11-21");
    expect(staged()).toHaveLength(0);
  });
  it("holds a template title when a selected input cannot apply after an external edit", async () => {
    fixture = new Fixture();
    await applyCandidates(fixture.ctx, 1, [
      type,
      { ...correspondent, passed: false },
      {
        field: "title",
        value: "Acme Invoice",
        passed: true,
        confidence: 1,
        templateInputs: ["correspondent"],
      },
    ]);
    const doc = fixture.docs.get(1);
    if (doc) doc.correspondent = 42;
    await approveReview(fixture.ctx, 1);
    expect(doc?.title).toBe("");
    expect(staged().map((change) => change.field_name)).toContain("title");
  });
  it("does not overwrite a human correspondent when approving its shared new-entity proposal", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { correspondent: 42 }));
    await applyCandidates(fixture.ctx, 1, [
      type,
      {
        field: "correspondent",
        value: "New",
        passed: false,
        confidence: 1,
        newEntity: { kind: "correspondent", name: "New" },
      },
    ]);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    await resolveProposal(fixture.ctx, proposal.id, "approve");
    expect(fixture.docs.get(1)?.correspondent).toBe(42);
    expect(staged()).toHaveLength(1);
  });
  it("never releases dependent fields while an entity-type proposal is unresolved", async () => {
    fixture = new Fixture();
    await applyCandidates(fixture.ctx, 1, [
      {
        field: "document_type",
        value: "New type",
        passed: false,
        confidence: 1,
        newEntity: { kind: "document_type", name: "New type" },
      },
      correspondent,
    ]);
    await approveReview(fixture.ctx, 1);
    expect(fixture.docs.get(1)?.document_type).toBeNull();
    expect(fixture.docs.get(1)?.correspondent).toBeNull();
    expect(staged()).toHaveLength(2);
  });
  it("keeps unrelated human conflicts staged when approving a shared entity", async () => {
    fixture = new Fixture();
    fixture.docs.set(1, document(1, { title: "Human title" }));
    await applyCandidates(fixture.ctx, 1, [
      type,
      { field: "title", value: "AI title", passed: true, confidence: 1 },
      {
        field: "correspondent",
        value: "New",
        passed: false,
        confidence: 1,
        newEntity: { kind: "correspondent", name: "New" },
      },
    ]);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    await resolveProposal(fixture.ctx, proposal.id, "approve");
    expect(fixture.docs.get(1)?.title).toBe("Human title");
    expect(staged().map((change) => change.field_name)).toContain("title");
  });
  it("approves selected fields and preserves edits made after staging", async () => {
    fixture = new Fixture();
    await applyCandidates(fixture.ctx, 1, [type, { ...correspondent, passed: false }]);
    const change = staged()[0];
    if (!change) throw new Error("fixture");
    const doc = fixture.docs.get(1);
    if (doc) doc.correspondent = 7;
    expect((await approveReview(fixture.ctx, 1, [change.id])).conflicts).toEqual([change.id]);
    expect(doc?.correspondent).toBe(7);
    if (doc) doc.correspondent = null;
    await approveReview(fixture.ctx, 1, [change.id]);
    expect(doc?.correspondent).toBe(1);
    expect(doc?.tags).toEqual([99]);
  });
  it("deduplicates new entities across docs and resolves them with one approval", async () => {
    fixture = new Fixture();
    fixture.docs.set(2, document(2));
    const newEntity: Candidate = {
      field: "correspondent",
      value: "New Corp",
      passed: false,
      confidence: 0.99,
      newEntity: { kind: "correspondent", name: "New Corp" },
    };
    for (const docId of [1, 2]) await applyCandidates(fixture.ctx, docId, [type, newEntity]);
    const proposals = fixture.db.prepare("SELECT * FROM proposals").all() as Proposal[];
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    if (!proposal) throw new Error("fixture");
    expect((await resolveProposal(fixture.ctx, proposal.id, "approve")).resolved).toBe(2);
    expect(fixture.docs.get(1)?.correspondent).toBe(fixture.docs.get(2)?.correspondent);
    expect(
      fixture.calls.filter(
        (call) => call.method === "POST" && call.url.pathname === "/api/correspondents/",
      ),
    ).toHaveLength(1);
    expect(staged()).toHaveLength(0);
  });
  it("maps proposals to existing entities and remembers rejected names", async () => {
    fixture = new Fixture();
    const field: Candidate = {
      field: "correspondent",
      value: "Acme Alias",
      passed: false,
      confidence: 1,
      newEntity: { kind: "correspondent", name: "Acme Alias" },
    };
    await applyCandidates(fixture.ctx, 1, [type, field]);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    await resolveProposal(fixture.ctx, proposal.id, "map", 1);
    expect(fixture.docs.get(1)?.correspondent).toBe(1);
    fixture.docs.set(2, document(2));
    await applyCandidates(fixture.ctx, 2, [
      type,
      { ...field, value: "Rejected", newEntity: { kind: "correspondent", name: "Rejected" } },
    ]);
    const rejected = fixture.db
      .prepare("SELECT * FROM proposals WHERE status='pending'")
      .get() as Proposal;
    await resolveProposal(fixture.ctx, rejected.id, "reject");
    fixture.docs.set(3, document(3));
    await applyCandidates(fixture.ctx, 3, [
      type,
      { ...field, value: "Rejected", newEntity: { kind: "correspondent", name: "Rejected" } },
    ]);
    expect(fixture.db.prepare("SELECT * FROM proposals WHERE status='pending'").all()).toHaveLength(
      0,
    );
    await rejectReview(fixture.ctx, 3);
    expect(fixture.docs.get(3)?.tags).toEqual([99]);
  });
});
