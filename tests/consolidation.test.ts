import { afterEach, describe, expect, it } from "vitest";
import {
  blockingReferences,
  candidates,
  execute,
  scan,
  undo,
  verifyGroup,
} from "../src/consolidation/engine.js";
import { type Proposal, propose } from "../src/db/store.js";
import { document, Fixture } from "./helpers.js";

let fixture: Fixture;
afterEach(() => fixture?.close());
describe("consolidation", () => {
  it.each([
    "parent",
    "inbox",
  ])("retains a retired %s tag instead of silently deleting it", async (kind) => {
    fixture = new Fixture();
    fixture.catalog.tags.push({
      id: 30,
      name: "finance AG",
      ...(kind === "inbox" ? { is_inbox_tag: true } : {}),
    });
    if (kind === "parent") fixture.catalog.tags.push({ id: 31, name: "Child", parent: 30 });
    const proposal = propose(fixture.db, "merge", "tag", `protected-${kind}`, {
      canonicalId: 20,
      retiredIds: [30],
      names: { 20: "finance", 30: "finance AG" },
    });
    const result = await execute(fixture.ctx, proposal.id);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(kind === "parent" ? "tag_children" : "inbox_tags");
    expect(fixture.catalog.tags.some((tag) => tag.id === 30)).toBe(true);
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });
  it("retains retired entities when the Paperless token is not a superuser", async () => {
    fixture = new Fixture();
    fixture.isSuperuser = false;
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    const proposal = propose(fixture.db, "merge", "correspondent", "non-superuser", {
      canonicalId: 1,
      retiredIds: [3],
      names: { 1: "Acme GmbH", 3: "Acme AG" },
    });
    const result = await execute(fixture.ctx, proposal.id);
    expect(fixture.docs.get(1)?.correspondent).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("non_superuser_token");
    expect(fixture.catalog.correspondents.some((entry) => entry.id === 3)).toBe(true);
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });
  it("reports superuser_check_failed distinctly when /ui_settings/ errors transiently", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    fixture.fail = (url) =>
      url.pathname === "/api/ui_settings/" ? new Response("{}", { status: 503 }) : undefined;
    const proposal = propose(fixture.db, "merge", "correspondent", "superuser-check-failed", {
      canonicalId: 1,
      retiredIds: [3],
      names: { 1: "Acme GmbH", 3: "Acme AG" },
    });
    const result = await execute(fixture.ctx, proposal.id);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("superuser_check_failed");
    expect(fixture.calls.some((call) => call.method === "DELETE")).toBe(false);
  });
  it("can undo a batch after a retirement response was lost", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    const proposal = propose(fixture.db, "merge", "correspondent", "lost-delete", {
      canonicalId: 1,
      retiredIds: [3],
      names: { 1: "Acme GmbH", 3: "Acme AG" },
    });
    fixture.fail = (url, init) => {
      if (init.method === "DELETE" && url.pathname === "/api/correspondents/3/") {
        fixture.catalog.correspondents.splice(
          fixture.catalog.correspondents.findIndex((entity) => entity.id === 3),
          1,
        );
        return new Response("{}", { status: 503 });
      }
      return undefined;
    };
    await expect(execute(fixture.ctx, proposal.id)).rejects.toThrow();
    fixture.fail = undefined;
    const saved = fixture.db
      .prepare("SELECT * FROM proposals WHERE id=?")
      .get(proposal.id) as Proposal;
    const reversed = await undo(fixture.ctx, saved.batch_id ?? "");
    expect(reversed.results.every((entry) => entry.status === "undone")).toBe(true);
    const recreated = fixture.catalog.correspondents.find((entity) => entity.name === "Acme AG");
    expect(fixture.docs.get(1)?.correspondent).toBe(recreated?.id);
  });
  it("uses one optional catalog suggestion call and journals provider usage", async () => {
    fixture = new Fixture();
    fixture.completions = [JSON.stringify({ pairs: [] })];
    await scan(fixture.ctx, true);
    expect(fixture.providerCalls("cloud.test")).toHaveLength(1);
    const job = fixture.db.prepare("SELECT * FROM jobs WHERE stage='consolidation'").get() as {
      config_hash: string;
      usage_json: string;
      state: string;
    };
    expect(job.config_hash).toBe(fixture.ctx.configHash);
    expect(job.usage_json).toContain('"provider":"llm"');
    expect(job.state).toBe("done");
  });
  it("skips documents modified after merge even when the merged field is unchanged", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    fixture.references.workflows = [{ id: 50, correspondent: 3 }];
    const proposal = propose(fixture.db, "merge", "correspondent", "modified", {
      canonicalId: 1,
      retiredIds: [3],
      names: { 1: "Acme GmbH", 3: "Acme AG" },
    });
    const result = await execute(fixture.ctx, proposal.id);
    const doc = fixture.docs.get(1);
    if (doc) {
      doc.title = "External edit";
      doc.modified = "2026-11-22T00:00:00Z";
    }
    expect((await undo(fixture.ctx, result.batchId)).results[0]?.status).toBe(
      "externally_modified",
    );
    expect(doc?.correspondent).toBe(1);
  });
  it("normalizes German names/suffixes and never assumes transitive equivalence", async () => {
    fixture = new Fixture();
    const a = { id: 1, name: "Müller GmbH" },
      b = { id: 2, name: "Mueller AG" },
      c = { id: 3, name: "Müller Tochter UG" };
    expect(candidates([a, b, c]).length).toBeGreaterThan(0);
    fixture.jev = (_state, question) => ({
      type: "noul",
      noul: question.instructions.includes("Tochter") ? 0.01 : 0.999,
    });
    expect(await verifyGroup(fixture.ctx, "correspondent", a, [b, c])).toEqual([b]);
    expect(fixture.providerCalls("jev.test")).toHaveLength(2);
  });
  it("creates scored proposals and skips previously dismissed pairs", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    expect(await scan(fixture.ctx)).toBe(1);
    const proposal = fixture.db.prepare("SELECT * FROM proposals").get() as Proposal;
    fixture.db.prepare("UPDATE proposals SET status='rejected' WHERE id=?").run(proposal.id);
    const calls = fixture.providerCalls("jev.test").length;
    expect(await scan(fixture.ctx)).toBe(0);
    expect(fixture.providerCalls("jev.test")).toHaveLength(calls);
  });
  it("blocks retirement for workflows, saved views and mail rules", () => {
    expect(
      blockingReferences(
        { tag_children: [{ id: 31, parent: 30 }], inbox_tags: [{ id: 30 }] },
        30,
        "correspondent",
      ),
    ).toEqual([]);
    expect(blockingReferences({ tag_children: [{ id: 31, parent: 30 }] }, 31, "tag")).toEqual([]);
    expect(
      blockingReferences(
        {
          workflows: [{ id: 100, actions: { assign_correspondent: 2 } }],
          saved_views: [{ id: 101, filter_rules: [{ rule_type: 3, value: "2" }] }],
          mail_rules: [{ id: 102, assign_correspondent: 2 }],
        },
        2,
      ),
    ).toEqual(["workflows:100", "saved_views:101", "mail_rules:102"]);
  });
  it("reassigns documents, stores aliases, and keeps referenced retired entities", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    fixture.references.workflows = [{ id: 500, actions: [{ assign_correspondent: 3 }] }];
    const proposal = propose(
      fixture.db,
      "merge",
      "correspondent",
      "merge",
      { canonicalId: 1, retiredIds: [3], names: { 1: "Acme GmbH", 3: "Acme AG" } },
      0.999,
    );
    const result = await execute(fixture.ctx, proposal.id);
    expect(fixture.docs.get(1)?.correspondent).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(fixture.catalog.correspondents.some((entity) => entity.id === 3)).toBe(true);
    expect(fixture.db.prepare("SELECT * FROM aliases WHERE key_kind='name'").all()).toHaveLength(1);
    expect(
      fixture.db
        .prepare("SELECT * FROM changes WHERE batch_id=? AND status='applied'")
        .all(result.batchId),
    ).toHaveLength(1);
    expect(
      (await undo(fixture.ctx, result.batchId)).results.every((entry) => entry.status === "undone"),
    ).toBe(true);
    expect(fixture.docs.get(1)?.correspondent).toBe(3);
  });
  it("deletes unreferenced entities and recreates them on precondition-checked undo", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Acme AG" });
    fixture.docs.set(1, document(1, { correspondent: 3 }));
    fixture.docs.set(2, document(2, { correspondent: 3 }));
    const proposal = propose(fixture.db, "merge", "correspondent", "merge", {
      canonicalId: 1,
      retiredIds: [3],
      names: { 1: "Acme GmbH", 3: "Acme AG" },
    });
    const result = await execute(fixture.ctx, proposal.id);
    expect(fixture.catalog.correspondents.some((entity) => entity.id === 3)).toBe(false);
    const doc = fixture.docs.get(2);
    if (doc) doc.correspondent = 42;
    const reversal = await undo(fixture.ctx, result.batchId);
    expect(reversal.results.map((entry) => entry.status)).toContain("externally_modified");
    expect(fixture.docs.get(2)?.correspondent).toBe(42);
    const recreated = fixture.catalog.correspondents.find((entity) => entity.name === "Acme AG");
    expect(recreated?.matching_algorithm).toBe(0);
    expect(fixture.docs.get(1)?.correspondent).toBe(recreated?.id);
  });
  it("moves tags by deltas and undoes only the recorded tag memberships", async () => {
    fixture = new Fixture();
    fixture.catalog.tags.push({ id: 30, name: "finance AG" });
    fixture.docs.set(1, document(1, { tags: [99, 30] }));
    const proposal = propose(fixture.db, "merge", "tag", "tags", {
      canonicalId: 20,
      retiredIds: [30],
      names: { 20: "finance", 30: "finance AG" },
    });
    const result = await execute(fixture.ctx, proposal.id);
    expect(fixture.docs.get(1)?.tags).toEqual([99, 20]);
    await undo(fixture.ctx, result.batchId);
    const restored = fixture.catalog.tags.find((entity) => entity.name === "finance AG");
    expect(fixture.docs.get(1)?.tags).toContain(restored?.id);
    expect(fixture.docs.get(1)?.tags).toContain(99);
    expect(fixture.docs.get(1)?.tags).not.toContain(20);
  });
  it("refuses a merge when direct equivalence no longer passes", async () => {
    fixture = new Fixture();
    fixture.catalog.correspondents.push({ id: 3, name: "Different" });
    fixture.jev = () => ({ type: "noul", noul: 0.01 });
    const proposal = propose(fixture.db, "merge", "correspondent", "merge", {
      canonicalId: 1,
      retiredIds: [3],
      names: {},
    });
    await expect(execute(fixture.ctx, proposal.id)).rejects.toThrow("equivalence");
    expect(
      fixture.calls.filter((call) => call.method === "PATCH" || call.method === "DELETE"),
    ).toHaveLength(0);
  });
});
