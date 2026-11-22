import { type Change, getSource, type Proposal, propose, recordChange } from "../db/store.js";
import type { DocumentPatch, PaperlessDocument } from "../paperless/client.js";
import { empty, equal, json, now, parseJson } from "../util.js";
import type { Candidate, Context } from "./context.js";
import { templateTitle } from "./layer2Classify.js";
import { normalize } from "./shortlist.js";

export function fieldValue(
  doc: PaperlessDocument,
  field: string,
  checks: Record<string, unknown> = {},
): unknown {
  if (field.startsWith("custom:"))
    return doc.custom_fields.find((entry) => entry.field === checks.customFieldId)?.value ?? null;
  if (field.startsWith("tag:")) return doc.tags.includes(Number(checks.tagId));
  return doc[field] ?? null;
}
export async function serviceTags(
  ctx: Context,
  docId: number,
  result: "review" | "failed" | "clean",
) {
  const tags = await ctx.paperless.listEntities("tag");
  const names = [ctx.config.tags.requested, ctx.config.tags.review, ctx.config.tags.failed];
  const desiredName = result === "clean" ? undefined : ctx.config.tags[result];
  let desired = tags.find((tag) => tag.name === desiredName);
  if (desiredName && !desired) desired = await ctx.paperless.createEntity("tag", desiredName);
  const add = desired ? [desired.id] : [];
  const remove = tags
    .filter((tag) => names.includes(tag.name) && tag.id !== desired?.id)
    .map((tag) => tag.id);
  await ctx.paperless.modifyTags(docId, add, remove);
}
function humanOwned(ctx: Context, doc: PaperlessDocument, field: Candidate) {
  const current = fieldValue(doc, field.field, field.checks);
  if (empty(current)) return false;
  // False is a meaningful boolean; tags are compared individually, never as a whole array.
  if (field.field.startsWith("tag:") && current === false) return false;
  const last = ctx.db
    .prepare(
      "SELECT * FROM changes WHERE doc_id=? AND field_name=? AND status='applied' AND verified_at IS NOT NULL ORDER BY applied_at DESC, rowid DESC LIMIT 1",
    )
    .get(doc.id, field.field) as Change | undefined;
  return !last || !equal(current, parseJson(last.proposed_value_json, null));
}
function addToPatch(
  patch: DocumentPatch,
  doc: PaperlessDocument,
  field: string,
  value: unknown,
  checks: Record<string, unknown>,
) {
  if (field.startsWith("custom:")) {
    const fieldId = Number(checks.customFieldId);
    if (!Number.isSafeInteger(fieldId) || fieldId <= 0) throw new Error("Missing custom field ID");
    patch.custom_fields ??= doc.custom_fields.map((entry) => ({ ...entry }));
    const previous = patch.custom_fields.find((entry) => entry.field === fieldId);
    if (previous) previous.value = value;
    else patch.custom_fields.push({ field: fieldId, value });
  } else if (field === "title") {
    if (typeof value !== "string") throw new Error("Title must be a string");
    patch.title = value;
  } else if (field === "correspondent" || field === "document_type") {
    if (value !== null && (!Number.isSafeInteger(value) || Number(value) <= 0))
      throw new Error("Entity ID must be a positive integer");
    patch[field] = value as number | null;
  } else if (field === "created") {
    if (typeof value !== "string") throw new Error("Created must be a date");
    patch.created = value;
  } else if (!field.startsWith("tag:")) throw new Error(`Unsupported document field: ${field}`);
}
export async function applyChanges(
  ctx: Context,
  docId: number,
  changes: Change[],
  explicit = false,
) {
  const current = await ctx.paperless.getDocument(docId);
  const patch: DocumentPatch = {},
    add: number[] = [],
    remove: number[] = [];
  const accepted: Change[] = [],
    conflicts: string[] = [];
  for (const change of [...changes].sort(
    (a, b) => Number(a.field_name === "title") - Number(b.field_name === "title"),
  )) {
    const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
    const proposed = parseJson<unknown>(change.proposed_value_json, null);
    const original = parseJson<unknown>(change.original_value_json, null);
    const value = fieldValue(current, change.field_name, checks);
    const inputs = checks.templateInputs as string[] | undefined;
    if (
      inputs?.some((input) =>
        changes.some(
          (dependency) =>
            dependency !== change &&
            dependency.field_name.replace(/^custom:/, "") === input &&
            !accepted.includes(dependency),
        ),
      )
    ) {
      conflicts.push(change.id);
      continue;
    }
    if (change.proposal_id) {
      const proposal = ctx.db
        .prepare("SELECT * FROM proposals WHERE id=?")
        .get(change.proposal_id) as Proposal | undefined;
      if (proposal?.status !== "approved") {
        conflicts.push(change.id);
        continue;
      }
    }
    if (checks.typeValid === false || (!explicit && checks.candidatePassed === false)) {
      conflicts.push(change.id);
      continue;
    }
    if (
      (change.field_name === "document_type" &&
        (proposed === null || !Number.isSafeInteger(proposed))) ||
      (change.field_name === "title" && typeof proposed !== "string") ||
      (change.field_name.startsWith("tag:") &&
        (typeof proposed !== "boolean" || !Number.isSafeInteger(checks.tagId)))
    ) {
      conflicts.push(change.id);
      continue;
    }
    if (!equal(value, original) && !equal(value, proposed)) {
      conflicts.push(change.id);
      continue;
    }
    if (!equal(value, proposed)) {
      addToPatch(patch, current, change.field_name, proposed, checks);
      if (change.field_name.startsWith("tag:")) {
        if (typeof proposed !== "boolean" || !Number.isSafeInteger(checks.tagId))
          throw new Error("Invalid tag change");
        (proposed ? add : remove).push(Number(checks.tagId));
      }
    }
    accepted.push(change);
  }
  if (Object.keys(patch).length) await ctx.paperless.patchDocument(docId, patch);
  if (add.length || remove.length) await ctx.paperless.modifyTags(docId, add, remove);
  const verified = await ctx.paperless.getDocument(docId);
  ctx.db.transaction(() => {
    for (const change of accepted) {
      const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
      const matches = equal(
        fieldValue(verified, change.field_name, checks),
        parseJson(change.proposed_value_json, null),
      );
      ctx.db
        .prepare(
          "UPDATE changes SET status=?, applied_at=?, verified_at=?,check_results_json=? WHERE id=?",
        )
        .run(
          matches ? "applied" : "failed",
          now(),
          matches ? now() : null,
          json({ ...checks, modifiedAfterApply: verified.modified }),
          change.id,
        );
      if (!matches) conflicts.push(change.id);
    }
  })();
  if (conflicts.length)
    return {
      applied:
        accepted.length -
        conflicts.filter((value) => accepted.some((change) => change.id === value)).length,
      conflicts,
    };
  return { applied: accepted.length, conflicts };
}
export async function applyCandidates(ctx: Context, docId: number, fields: Candidate[]) {
  const doc = await ctx.paperless.getDocument(docId);
  const type = fields.find((field) => field.field === "document_type");
  const typeBlocked =
    !type?.passed ||
    !Number.isSafeInteger(type.value) ||
    Number(type.value) <= 0 ||
    Boolean(type.newEntity) ||
    (humanOwned(ctx, doc, type) && !equal(doc.document_type, type.value));
  const blocked = fields.filter(
    (field) =>
      !field.passed ||
      field.newEntity ||
      (humanOwned(ctx, doc, field) &&
        !equal(fieldValue(doc, field.field, field.checks), field.value)),
  );
  const stageAll = typeBlocked || (ctx.config.stagingMode === "document" && blocked.length > 0);
  const ready: Change[] = [];
  for (const field of fields) {
    const current = fieldValue(doc, field.field, field.checks);
    if (equal(current, field.value) && !field.newEntity && field.passed) continue;
    let proposal: Proposal | undefined;
    if (field.newEntity)
      proposal = propose(
        ctx.db,
        "new_entity",
        field.newEntity.kind,
        `new:${field.newEntity.kind}:${normalize(field.newEntity.name)}`,
        { name: field.newEntity.name },
        field.confidence,
        { quote: field.evidenceQuote },
      );
    const conflict = humanOwned(ctx, doc, field) && !equal(current, field.value);
    const templateBlocked = field.templateInputs?.some((input) =>
      blocked.some((entry) => entry.field.replace(/^custom:/, "") === input),
    );
    const passing = !stageAll && field.passed && !proposal && !conflict && !templateBlocked;
    const checks = {
      ...field.checks,
      candidatePassed: field.passed,
      humanConflict: conflict,
      dependencyBlocked: stageAll || Boolean(templateBlocked),
      templateInputs: field.templateInputs,
    };
    let change = ctx.db
      .prepare(
        "SELECT * FROM changes WHERE doc_id=? AND field_name=? AND proposed_value_json=? AND status='staged'",
      )
      .get(docId, field.field, json(field.value ?? null)) as Change | undefined;
    if (!change) {
      const changeId = recordChange(ctx.db, {
        docId,
        field: field.field,
        original: current,
        proposed: field.value,
        proposalId: proposal?.id,
        evidence: field.evidenceQuote,
        confidence: field.confidence,
        checks,
        status: proposal?.status === "rejected" ? "rejected" : "staged",
      });
      change = ctx.db.prepare("SELECT * FROM changes WHERE id=?").get(changeId) as Change;
    }
    if (passing) ready.push(change);
  }
  const result = await applyChanges(ctx, docId, ready);
  const staged = (
    ctx.db
      .prepare(
        "SELECT count(*) AS count FROM changes WHERE doc_id=? AND status IN ('staged','failed')",
      )
      .get(docId) as { count: number }
  ).count;
  await serviceTags(ctx, docId, staged ? "review" : "clean");
  return { ...result, staged };
}
export async function approveReview(ctx: Context, docId: number, selected?: string[]) {
  const changes = ctx.db
    .prepare("SELECT * FROM changes WHERE doc_id=? AND status='staged' ORDER BY created_at")
    .all(docId) as Change[];
  const chosen = selected ? changes.filter((change) => selected.includes(change.id)) : changes;
  const pendingType = changes.find((change) => change.field_name === "document_type");
  // Apply the type first and verify it before releasing dependent fields.
  let typeResult = { applied: 0, conflicts: [] as string[] };
  if (pendingType && chosen.includes(pendingType))
    typeResult = await applyChanges(ctx, docId, [pendingType], true);
  const typeResolved = !pendingType || typeResult.applied === 1;
  // A selected title waits for every selected/staged template input to be resolved.
  const safe = chosen.filter((change) => {
    const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
    if (change === pendingType) return false;
    if (checks.dependencyBlocked && !typeResolved) return false;
    const inputs = checks.templateInputs as string[] | undefined;
    return !inputs?.some((input) =>
      changes.some(
        (entry) => entry.field_name.replace(/^custom:/, "") === input && !chosen.includes(entry),
      ),
    );
  });
  const result = await applyChanges(ctx, docId, safe, true);
  const title = changes.find(
    (change) => change.field_name === "title" && change.proposed_value_json === "null",
  );
  if (title) {
    const checks = parseJson<Record<string, unknown>>(title.check_results_json, {});
    const inputs = checks.templateInputs as string[] | undefined;
    const unresolved = ctx.db
      .prepare(
        "SELECT * FROM changes WHERE doc_id=? AND status IN ('staged','failed') AND field_name!='title'",
      )
      .all(docId) as Change[];
    if (
      inputs &&
      !unresolved.some(
        (change) =>
          change.field_name === "document_type" ||
          inputs.includes(change.field_name.replace(/^custom:/, "")),
      )
    ) {
      const doc = await ctx.paperless.getDocument(docId);
      const catalog = await ctx.paperless.catalog();
      const fields: Candidate[] = [
        {
          field: "correspondent",
          value: doc.correspondent,
          passed: true,
          confidence: 1,
          checks: {
            displayValue: catalog.correspondents.find((entity) => entity.id === doc.correspondent)
              ?.name,
          },
        },
        {
          field: "document_type",
          value: doc.document_type,
          passed: true,
          confidence: 1,
          checks: {
            displayValue: catalog.document_types.find((entity) => entity.id === doc.document_type)
              ?.name,
          },
        },
        ...doc.custom_fields.map((field) => ({
          field: `custom:${catalog.custom_fields.find((entity) => entity.id === field.field)?.name}`,
          value: field.value,
          passed: true,
          confidence: 1,
        })),
      ];
      const candidate = templateTitle(
        ctx,
        fields,
        doc,
        catalog.document_types.find((entity) => entity.id === doc.document_type)?.name,
      );
      if (candidate?.passed) {
        const isHumanOwned = humanOwned(ctx, doc, candidate);
        const recomputed = {
          ...title,
          proposed_value_json: json(candidate.value),
          check_results_json: json({
            ...checks,
            candidatePassed: true,
            humanConflict: isHumanOwned,
            dependencyBlocked: false,
            ...candidate.checks,
          }),
        };
        ctx.db
          .prepare("UPDATE changes SET proposed_value_json=?,check_results_json=? WHERE id=?")
          .run(recomputed.proposed_value_json, recomputed.check_results_json, title.id);
        if (!isHumanOwned) {
          const applied = await applyChanges(ctx, docId, [recomputed], true);
          result.applied += applied.applied;
          result.conflicts = result.conflicts
            .filter((id) => id !== title.id)
            .concat(applied.conflicts);
        }
      }
    }
  }
  const remaining = (
    ctx.db
      .prepare(
        "SELECT count(*) AS count FROM changes WHERE doc_id=? AND status IN ('staged','failed')",
      )
      .get(docId) as { count: number }
  ).count;
  await serviceTags(ctx, docId, remaining ? "review" : "clean");
  return {
    applied: result.applied + typeResult.applied,
    conflicts: [...typeResult.conflicts, ...result.conflicts],
  };
}
export async function rejectReview(ctx: Context, docId: number) {
  ctx.db
    .prepare(
      "UPDATE changes SET status='rejected' WHERE doc_id=? AND status IN ('staged','failed')",
    )
    .run(docId);
  await serviceTags(ctx, docId, "clean");
}
export async function resolveProposal(
  ctx: Context,
  proposalId: string,
  resolution: "approve" | "reject" | "map",
  mappedId?: number,
) {
  const proposal = ctx.db.prepare("SELECT * FROM proposals WHERE id=?").get(proposalId) as
    | Proposal
    | undefined;
  if (!proposal || proposal.proposal_kind !== "new_entity")
    throw new Error("Entity proposal not found");
  if (proposal.status !== "pending") throw new Error("Proposal is already resolved");
  if (resolution === "reject") {
    ctx.db.transaction(() => {
      ctx.db
        .prepare("UPDATE proposals SET status='rejected',resolved_at=? WHERE id=?")
        .run(now(), proposalId);
      ctx.db
        .prepare("UPDATE changes SET status='rejected' WHERE proposal_id=? AND status='staged'")
        .run(proposalId);
    })();
    return { resolved: 0 };
  }
  const payload = parseJson<{ name: string; createdId?: number }>(proposal.payload_json, {
    name: "",
  });
  const catalog = await ctx.paperless.listEntities(proposal.entity_kind);
  // Re-check catalog after a crash between remote create and local persistence.
  let entity =
    resolution === "map"
      ? catalog.find((entry) => entry.id === mappedId)
      : catalog.find((entry) => normalize(entry.name) === normalize(payload.name));
  if (resolution === "map" && !entity) throw new Error("Mapped entity does not exist");
  entity ??= await ctx.paperless.createEntity(proposal.entity_kind, payload.name);
  const changes = ctx.db
    .prepare("SELECT * FROM changes WHERE proposal_id=? AND status='staged'")
    .all(proposalId) as Change[];
  const entityId = entity.id;
  ctx.db.transaction(() => {
    ctx.db
      .prepare("UPDATE proposals SET status='approved',payload_json=?,resolved_at=? WHERE id=?")
      .run(json({ ...payload, createdId: entityId }), now(), proposalId);
    for (const change of changes) {
      const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
      ctx.db
        .prepare("UPDATE changes SET proposed_value_json=?,check_results_json=? WHERE id=?")
        .run(
          json(proposal.entity_kind === "tag" ? true : entityId),
          json({
            ...checks,
            candidatePassed: true,
            proposalResolved: true,
            ...(proposal.entity_kind === "tag" ? { tagId: entityId } : {}),
          }),
          change.id,
        );
    }
  })();
  for (const docId of new Set(
    changes.flatMap((change) => (change.doc_id === null ? [] : [change.doc_id])),
  )) {
    const related = ctx.db
      .prepare("SELECT * FROM changes WHERE doc_id=? AND status='staged'")
      .all(docId) as Change[];
    const selected = related
      .filter((change) => {
        const checks = parseJson<Record<string, unknown>>(change.check_results_json, {});
        return (
          (change.proposal_id === proposalId || checks.candidatePassed === true) &&
          checks.humanConflict !== true
        );
      })
      .map((change) => change.id);
    await approveReview(ctx, docId, selected);
  }
  return { resolved: changes.length };
}
export function ocrReady(ctx: Context, docId: number) {
  return (
    !ctx.config.ocr.enabled ||
    ["done", "skipped"].includes(getSource(ctx.db, docId)?.ocr_status ?? "")
  );
}
