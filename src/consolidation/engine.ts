import { z } from "zod";
import { journal } from "../db/journal.js";
import {
  type Alias,
  type Change,
  type EntityKind,
  type Proposal,
  propose,
  recordChange,
} from "../db/store.js";
import type { Entity } from "../paperless/client.js";
import { applyChanges, fieldValue } from "../pipeline/apply.js";
import { type Context, entitiesOf } from "../pipeline/context.js";
import { normalize, similarity } from "../pipeline/shortlist.js";
import { equal, id, json, now, parseJson } from "../util.js";

interface MergePayload {
  canonicalId: number;
  retiredIds: number[];
  names: Record<string, string>;
}
const pairKey = (kind: EntityKind, a: number, b: number) =>
  `merge:${kind}:${[a, b].sort((x, y) => x - y).join(":")}`;
export function candidates(entities: Entity[], aliases: Alias[] = []) {
  const result: [Entity, Entity][] = [];
  for (let i = 0; i < entities.length; i++)
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i],
        b = entities[j];
      if (!a || !b) continue;
      const keysA = aliases
        .filter((alias) => alias.canonical_id === a.id)
        .map((alias) => alias.normalized_alias);
      const shared = aliases.some(
        (alias) => alias.canonical_id === b.id && keysA.includes(alias.normalized_alias),
      );
      if (shared || normalize(a.name) === normalize(b.name) || similarity(a.name, b.name) >= 0.55)
        result.push([a, b]);
    }
  return result;
}
async function verifyPair(ctx: Context, kind: EntityKind, canonical: Entity, member: Entity) {
  const query = (entity: Entity) =>
    kind === "tag" ? { tags__id__all: entity.id } : { [`${kind}__id`]: entity.id };
  const docs = [
    ...(await ctx.paperless.listDocuments(query(canonical))),
    ...(await ctx.paperless.listDocuments(query(member))),
  ];
  const state = docs
    .slice(0, 8)
    .map((doc) => `${doc.title}\n${doc.content.slice(0, 600)}`)
    .join("\n\n");
  const decision = await ctx.jev.noul(
    state,
    "Are " +
      JSON.stringify(canonical.name) +
      " and " +
      JSON.stringify(member.name) +
      " the same " +
      kind +
      "? Different subsidiaries, people, concepts, and document types are not equivalent.",
  );
  return {
    ...decision,
    equivalent: decision.value && decision.confidence >= ctx.config.jev.thresholds.consolidation,
  };
}
export async function verifyGroup(
  ctx: Context,
  kind: EntityKind,
  canonical: Entity,
  members: Entity[],
) {
  const verified: Entity[] = [];
  for (const member of members)
    if (member.id !== canonical.id && (await verifyPair(ctx, kind, canonical, member)).equivalent)
      verified.push(member);
  return verified;
}
export async function scan(ctx: Context, useL3 = false) {
  return journal(ctx, "consolidation-scan", (scoped) => scanImpl(scoped, useL3));
}
async function scanImpl(ctx: Context, useL3: boolean) {
  const catalog = await ctx.paperless.catalog();
  const suggestions = useL3
    ? (
        await ctx.llm.extractStructured(
          z.object({
            pairs: z
              .array(
                z.object({
                  kind: z.enum(["correspondent", "tag", "document_type"]),
                  canonicalId: z.number().int(),
                  memberId: z.number().int(),
                }),
              )
              .max(100),
          }),
          "Suggest possible duplicate catalog entities by name. Suggestions require independent checks.",
          JSON.stringify({
            correspondents: catalog.correspondents.map(({ id, name }) => ({ id, name })),
            tags: catalog.tags.map(({ id, name }) => ({ id, name })),
            document_types: catalog.document_types.map(({ id, name }) => ({ id, name })),
          }),
        )
      ).pairs
    : [];
  let total = 0;
  for (const kind of ["correspondent", "tag", "document_type"] as const) {
    const entities = entitiesOf(catalog, kind).filter(
      (entity) =>
        !Object.values({
          requested: ctx.config.tags.requested,
          review: ctx.config.tags.review,
          failed: ctx.config.tags.failed,
        }).includes(entity.name),
    );
    const aliases = ctx.db
      .prepare("SELECT * FROM aliases WHERE entity_kind=?")
      .all(kind) as Alias[];
    const pairs = candidates(entities, aliases);
    for (const pair of suggestions.filter((entry) => entry.kind === kind)) {
      const a = entities.find((entity) => entity.id === pair.canonicalId),
        b = entities.find((entity) => entity.id === pair.memberId);
      if (
        a &&
        b &&
        a.id !== b.id &&
        !pairs.some(([x, y]) => pairKey(kind, x.id, y.id) === pairKey(kind, a.id, b.id))
      )
        pairs.push([a, b]);
    }
    for (const [canonical, member] of pairs) {
      const key = pairKey(kind, canonical.id, member.id);
      if (
        ctx.db
          .prepare(
            "SELECT 1 FROM proposals WHERE dedup_key=? AND status IN ('pending','approved','rejected')",
          )
          .get(key)
      )
        continue;
      const decision = await verifyPair(ctx, kind, canonical, member);
      if (!decision.equivalent) continue;
      propose(
        ctx.db,
        "merge",
        kind,
        key,
        {
          canonicalId: canonical.id,
          retiredIds: [member.id],
          names: { [canonical.id]: canonical.name, [member.id]: member.name },
        } satisfies MergePayload,
        decision.confidence,
      );
      total++;
    }
  }
  return total;
}
export function blockingReferences(
  references: Record<string, unknown[]>,
  retiredId: number,
  entityKind?: EntityKind,
): string[] {
  const contains = (value: unknown): boolean => {
    if (value === retiredId || value === String(retiredId)) return true;
    if (typeof value === "string") return value.split(/[^0-9]+/).includes(String(retiredId));
    if (Array.isArray(value)) return value.some(contains);
    if (value && typeof value === "object") return Object.values(value).some(contains);
    return false;
  };
  // Fail closed on opaque reference structures. An unrelated matching number may keep an entity.
  return Object.entries(references).flatMap(([kind, rows]) => {
    // Tag hierarchy and inbox flags cannot reference correspondents or document types.
    if (entityKind && entityKind !== "tag" && ["tag_children", "inbox_tags"].includes(kind))
      return [];
    return rows
      .filter((row) =>
        kind === "tag_children" ? contains((row as { parent?: unknown }).parent) : contains(row),
      )
      .map((row, index) => `${kind}:${String((row as { id?: unknown }).id ?? index)}`);
  });
}
export async function execute(ctx: Context, proposalId: string) {
  return journal(ctx, "consolidation-merge", (scoped) => executeImpl(scoped, proposalId));
}
async function executeImpl(ctx: Context, proposalId: string) {
  const proposal = ctx.db.prepare("SELECT * FROM proposals WHERE id=?").get(proposalId) as
    | Proposal
    | undefined;
  if (!proposal || proposal.proposal_kind !== "merge" || proposal.status !== "pending")
    throw new Error("Pending merge not found");
  const payload = parseJson<MergePayload>(proposal.payload_json, {
    canonicalId: 0,
    retiredIds: [],
    names: {},
  });
  const entities = await ctx.paperless.listEntities(proposal.entity_kind);
  const canonical = entities.find((entity) => entity.id === payload.canonicalId);
  if (!canonical) throw new Error("Canonical entity no longer exists");
  const members = payload.retiredIds.flatMap((memberId) => {
    const entity = entities.find((entry) => entry.id === memberId);
    return entity ? [entity] : [];
  });
  for (const retiredId of payload.retiredIds.filter(
    (memberId) => !members.some((member) => member.id === memberId),
  )) {
    const intended = proposal.batch_id
      ? (ctx.db
          .prepare(
            "SELECT * FROM changes WHERE batch_id=? AND field_name='retired_entity' AND json_extract(original_value_json,'$.id')=?",
          )
          .get(proposal.batch_id, retiredId) as Change | undefined)
      : undefined;
    if (!intended) throw new Error("Merge member no longer exists; inspect batch state");
    ctx.db
      .prepare("UPDATE changes SET status='applied',applied_at=?,verified_at=? WHERE id=?")
      .run(now(), now(), intended.id);
  }
  // Every member must pass against canonical at execution, never through a transitive neighbour.
  if ((await verifyGroup(ctx, proposal.entity_kind, canonical, members)).length !== members.length)
    throw new Error("Merge equivalence verification failed");
  const batchId = proposal.batch_id ?? id();
  ctx.db.prepare("UPDATE proposals SET batch_id=? WHERE id=?").run(batchId, proposalId);
  const interrupted = ctx.db
    .prepare(
      "SELECT * FROM changes WHERE batch_id=? AND kind='consolidation_merge' AND status='staged'",
    )
    .all(batchId) as Change[];
  for (const change of interrupted) {
    const doc = await ctx.paperless.getDocument(Number(change.doc_id));
    const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
    if (
      equal(fieldValue(doc, change.field_name, checks), parseJson(change.proposed_value_json, null))
    ) {
      ctx.db
        .prepare(
          "UPDATE changes SET status='applied',applied_at=?,verified_at=?,check_results_json=? WHERE id=?",
        )
        .run(now(), now(), json({ ...checks, modifiedAfterApply: doc.modified }), change.id);
    }
  }
  const superuser = await ctx.paperless.superuserStatus();
  const warnings: string[] = [];
  for (const member of members) {
    const beforeReferences = blockingReferences(
      await ctx.paperless.references(),
      member.id,
      proposal.entity_kind,
    );
    const query =
      proposal.entity_kind === "tag"
        ? { tags__id__all: member.id }
        : { [`${proposal.entity_kind}__id`]: member.id };
    for (const doc of await ctx.paperless.listDocuments(query)) {
      const changes: string[] = [];
      if (proposal.entity_kind === "tag") {
        if (!doc.tags.includes(canonical.id))
          changes.push(
            recordChange(ctx.db, {
              docId: doc.id,
              batchId,
              kind: "consolidation_merge",
              field: `tag:${canonical.name}`,
              original: false,
              proposed: true,
              checks: { tagId: canonical.id },
            }),
          );
        changes.push(
          recordChange(ctx.db, {
            docId: doc.id,
            batchId,
            kind: "consolidation_merge",
            field: `tag:${member.name}`,
            original: true,
            proposed: false,
            checks: { tagId: member.id },
          }),
        );
      } else
        changes.push(
          recordChange(ctx.db, {
            docId: doc.id,
            batchId,
            kind: "consolidation_merge",
            field: proposal.entity_kind,
            original: member.id,
            proposed: canonical.id,
          }),
        );
      const rows = changes.map(
        (changeId) => ctx.db.prepare("SELECT * FROM changes WHERE id=?").get(changeId) as Change,
      );
      const result = await applyChanges(ctx, doc.id, rows, true);
      if (result.conflicts.length) throw new Error("Consolidation document changed externally");
    }
    ctx.db
      .prepare(
        "INSERT OR IGNORE INTO aliases(id,entity_kind,canonical_id,canonical_name,alias_text,normalized_alias,key_kind,created_at) VALUES(?,?,?,?,?,?,'name',?)",
      )
      .run(
        id(),
        proposal.entity_kind,
        canonical.id,
        canonical.name,
        member.name,
        normalize(member.name),
        now(),
      );
    ctx.db
      .prepare(
        "INSERT OR IGNORE INTO aliases(id,entity_kind,canonical_id,canonical_name,alias_text,normalized_alias,key_kind,created_at) VALUES(?,?,?,?,?,?,'retired_id',?)",
      )
      .run(
        id(),
        proposal.entity_kind,
        canonical.id,
        canonical.name,
        String(member.id),
        String(member.id),
        now(),
      );
    const references = [
      ...new Set([
        ...beforeReferences,
        ...blockingReferences(await ctx.paperless.references(), member.id, proposal.entity_kind),
      ]),
    ];
    const remaining = await ctx.paperless.listDocuments(query);
    if (references.length || remaining.length || superuser !== "superuser") {
      warnings.push(
        member.name +
          " retained; references: " +
          [
            ...references,
            ...(remaining.length ? ["documents"] : []),
            ...(superuser === "non_superuser"
              ? ["non_superuser_token"]
              : superuser === "unknown"
                ? ["superuser_check_failed"]
                : []),
          ].join(", "),
      );
    } else {
      const changeId = recordChange(ctx.db, {
        batchId,
        kind: "entity_create",
        field: "retired_entity",
        original: { id: member.id, name: member.name, kind: proposal.entity_kind },
        proposed: null,
      });
      await ctx.paperless.deleteEntity(proposal.entity_kind, member.id);
      if (
        (await ctx.paperless.listEntities(proposal.entity_kind)).some(
          (entity) => entity.id === member.id,
        )
      )
        throw new Error("Retired entity deletion not verified");
      ctx.db
        .prepare("UPDATE changes SET status='applied',applied_at=?,verified_at=? WHERE id=?")
        .run(now(), now(), changeId);
    }
  }
  ctx.db
    .prepare("UPDATE proposals SET status='approved',resolved_at=?,evidence_json=? WHERE id=?")
    .run(now(), json({ warnings }), proposalId);
  return { batchId, warnings };
}
export async function undo(ctx: Context, batchId: string) {
  const proposal = ctx.db.prepare("SELECT * FROM proposals WHERE batch_id=?").get(batchId) as
    | Proposal
    | undefined;
  const payload = parseJson<MergePayload>(proposal?.payload_json ?? null, {
    canonicalId: 0,
    retiredIds: [],
    names: {},
  });
  const uncertainRetirements = ctx.db
    .prepare(
      "SELECT * FROM changes WHERE batch_id=? AND field_name='retired_entity' AND status IN ('staged','failed')",
    )
    .all(batchId) as Change[];
  for (const change of uncertainRetirements) {
    const original = parseJson<{ id: number; kind: EntityKind }>(change.original_value_json, {
      id: 0,
      kind: "tag",
    });
    const exists = (await ctx.paperless.listEntities(original.kind)).some(
      (entity) => entity.id === original.id,
    );
    ctx.db
      .prepare(
        "UPDATE changes SET status=?,applied_at=?,verified_at=?,check_results_json=? WHERE id=?",
      )
      .run(
        exists ? "undone" : "applied",
        now(),
        now(),
        json(exists ? { restoredId: original.id } : {}),
        change.id,
      );
  }
  const rows = ctx.db
    .prepare(
      "SELECT * FROM changes WHERE batch_id=? AND status='applied' ORDER BY created_at DESC,rowid DESC",
    )
    .all(batchId) as Change[];
  const replacements = new Map<number, number>();
  const priorRestores = ctx.db
    .prepare(
      "SELECT * FROM changes WHERE batch_id=? AND field_name='retired_entity' AND status='undone'",
    )
    .all(batchId) as Change[];
  for (const change of priorRestores) {
    const old = parseJson<{ id: number }>(change.original_value_json, { id: 0 });
    const checks = parseJson<{ restoredId?: number }>(change.check_results_json, {});
    if (checks.restoredId) replacements.set(old.id, checks.restoredId);
  }
  const results: { changeId: string; status: "undone" | "externally_modified" | "failed" }[] = [];
  const externallyModified = new Set<number>();
  const checkedDocs = new Set<number>();
  for (const change of rows) {
    if (change.doc_id === null || checkedDocs.has(change.doc_id)) continue;
    checkedDocs.add(change.doc_id);
    const expected = parseJson<{ modifiedAfterApply?: string }>(
      change.check_results_json,
      {},
    ).modifiedAfterApply;
    const current = await ctx.paperless.getDocument(change.doc_id);
    if (expected && current.modified && current.modified !== expected)
      externallyModified.add(change.doc_id);
  }
  for (const change of rows.filter((row) => row.field_name === "retired_entity")) {
    const original = parseJson<{ id: number; name: string; kind: EntityKind }>(
      change.original_value_json,
      { id: 0, name: "", kind: "tag" },
    );
    const entities = await ctx.paperless.listEntities(original.kind);
    let entity =
      entities.find((entry) => entry.id === original.id) ??
      entities.find((entry) => entry.id !== payload.canonicalId && entry.name === original.name);
    entity ??= await ctx.paperless.createEntity(original.kind, original.name);
    replacements.set(original.id, entity.id);
    ctx.db
      .prepare("UPDATE changes SET status='undone',check_results_json=? WHERE id=?")
      .run(json({ restoredId: entity.id }), change.id);
    results.push({ changeId: change.id, status: "undone" });
  }
  for (const change of rows.filter((row) => row.doc_id !== null)) {
    if (externallyModified.has(Number(change.doc_id))) {
      results.push({ changeId: change.id, status: "externally_modified" });
      continue;
    }
    const original = parseJson<unknown>(change.original_value_json, null);
    const proposed = parseJson<unknown>(change.proposed_value_json, null);
    const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
    const tagId = Number(checks.tagId);
    const restoredChecks = change.field_name.startsWith("tag:")
      ? { ...checks, tagId: replacements.get(tagId) ?? tagId }
      : checks;
    const restored = change.field_name.startsWith("tag:")
      ? original
      : typeof original === "number"
        ? (replacements.get(original) ?? original)
        : original;
    const reverse: Change = {
      ...change,
      original_value_json: json(proposed),
      proposed_value_json: json(restored),
      check_results_json: json(restoredChecks),
    };
    try {
      const outcome = await applyChanges(ctx, Number(change.doc_id), [reverse], true);
      if (outcome.conflicts.length)
        results.push({ changeId: change.id, status: "externally_modified" });
      else {
        ctx.db
          .prepare(
            "UPDATE changes SET status='undone',original_value_json=?,proposed_value_json=?,check_results_json=? WHERE id=?",
          )
          .run(
            change.original_value_json,
            change.proposed_value_json,
            change.check_results_json,
            change.id,
          );
        results.push({ changeId: change.id, status: "undone" });
      }
    } catch {
      results.push({ changeId: change.id, status: "failed" });
    }
  }
  if (proposal && results.every((entry) => entry.status === "undone")) {
    for (const memberId of payload.retiredIds) {
      ctx.db
        .prepare(
          "DELETE FROM aliases WHERE entity_kind=? AND canonical_id=? AND ((key_kind='retired_id' AND normalized_alias=?) OR (key_kind='name' AND normalized_alias=?))",
        )
        .run(
          proposal.entity_kind,
          payload.canonicalId,
          String(memberId),
          normalize(payload.names[String(memberId)] ?? ""),
        );
    }
    ctx.db
      .prepare("UPDATE proposals SET status='undone',resolved_at=? WHERE id=?")
      .run(now(), proposal.id);
  }
  return { batchId, results };
}
