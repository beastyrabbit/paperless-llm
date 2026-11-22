import type { OpenField } from "../config/index.js";
import type { Catalog, PaperlessDocument } from "../paperless/client.js";
import type { Candidate, Context } from "./context.js";
import { NONE, shortlist, UNRESOLVED } from "./shortlist.js";

export interface Classification {
  fields: Candidate[];
  documentTypeName?: string;
  openFields: OpenField[];
  needsL3: boolean;
  shortlists: Record<string, Record<string, string>>;
}
export function templateTitle(
  ctx: Context,
  fields: Candidate[],
  doc: PaperlessDocument,
  typeName?: string,
): Candidate | undefined {
  const template = typeName ? ctx.config.documentTypes[typeName]?.titleTemplate : undefined;
  if (!template) return;
  const inputs = [...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1] ?? "");
  const values = new Map<string, unknown>([["created", doc.created?.slice(0, 10)]]);
  for (const field of fields)
    if (field.passed && !field.newEntity) {
      values.set(field.field.replace(/^custom:/, ""), field.checks?.displayValue ?? field.value);
    }
  if (inputs.some((input) => values.get(input) === undefined || values.get(input) === null))
    return {
      field: "title",
      value: null,
      passed: false,
      confidence: 0,
      templateInputs: inputs,
      checks: { reason: "Template inputs unresolved" },
    };
  return {
    field: "title",
    value: template
      .replace(/\{([^{}]+)\}/g, (_, name: string) => String(values.get(name)))
      .slice(0, 128),
    passed: true,
    confidence: 1,
    templateInputs: inputs,
    checks: { template: true },
  };
}
export async function classify(
  ctx: Context,
  doc: PaperlessDocument,
  catalog: Catalog,
): Promise<Classification> {
  const fields: Candidate[] = [];
  const lists: Classification["shortlists"] = {};
  const selectEntity = async (field: "document_type" | "correspondent", threshold: number) => {
    const entities = field === "document_type" ? catalog.document_types : catalog.correspondents;
    const candidates = shortlist(
      ctx.db,
      doc.content,
      entities,
      field,
      ctx.config.jev.shortlistLimit,
    );
    lists[field] = candidates.criteria;
    const decision = await ctx.jev.choice(
      doc.content,
      `Select the document's ${field}. Prefer unresolved over guessing.`,
      candidates.criteria,
    );
    const entity = candidates.entities.find((entry) => String(entry.id) === decision.value);
    const passed =
      decision.confidence >= threshold &&
      decision.value !== UNRESOLVED &&
      (Boolean(entity) || (field === "correspondent" && decision.value === NONE));
    fields.push({
      field,
      value: entity?.id ?? null,
      confidence: decision.confidence,
      passed,
      checks: { layer: 2, choice: decision.value, displayValue: entity?.name, threshold },
    });
    return entity && passed ? entity.name : undefined;
  };
  const documentTypeName = await selectEntity(
    "document_type",
    ctx.config.jev.thresholds.documentType,
  );
  await selectEntity("correspondent", ctx.config.jev.thresholds.correspondent);
  await Promise.all(
    Object.entries(ctx.config.tags.curated).map(async ([name, definition]) => {
      const decision = await ctx.jev.noul(
        doc.content,
        `Does this document belong to tag ${name}? ${definition}`,
      );
      const entity = catalog.tags.find((tag) => tag.name === name);
      fields.push({
        field: `tag:${name}`,
        value: decision.value,
        confidence: decision.confidence,
        passed: Boolean(entity) && decision.confidence >= ctx.config.jev.thresholds.tag,
        ...(!entity && decision.value ? { newEntity: { kind: "tag" as const, name } } : {}),
        checks: { layer: 2, tagId: entity?.id, threshold: ctx.config.jev.thresholds.tag },
      });
    }),
  );
  const schema = documentTypeName ? ctx.config.documentTypes[documentTypeName] : undefined;
  const closed =
    schema?.openFields.filter((field) => field.kind === "boolean" || field.kind === "select") ?? [];
  for (const name of schema?.selectFields ?? []) {
    if (!closed.some((field) => field.name === name))
      closed.push({ name, kind: "select", required: false, semanticCheck: false });
  }
  for (const field of closed) {
    const definition = catalog.custom_fields.find((entry) => entry.name === field.name);
    if (!definition) {
      fields.push({
        field: `custom:${field.name}`,
        value: null,
        passed: false,
        confidence: 0,
        checks: { reason: "Custom field not configured in Paperless" },
      });
      continue;
    }
    if (field.kind === "boolean") {
      const decision = await ctx.jev.noul(
        doc.content,
        `Evaluate ${field.name}: ${field.description ?? field.name}`,
      );
      fields.push({
        field: `custom:${field.name}`,
        value: decision.value,
        confidence: decision.confidence,
        passed: decision.confidence >= ctx.config.jev.thresholds.customField,
        checks: { layer: 2, customFieldId: definition.id },
      });
    } else {
      const options = (definition.extra_data?.select_options ?? []).slice(0, 253);
      const criteria = Object.fromEntries([
        ...options.map((option) => [String(option.id), option.label]),
        [NONE, "Not applicable"],
        [UNRESOLVED, "Insufficient evidence"],
      ]) as Record<string, string>;
      lists[`custom:${field.name}`] = criteria;
      const decision = await ctx.jev.choice(doc.content, `Select ${field.name}`, criteria);
      const option = options.find((entry) => String(entry.id) === decision.value);
      fields.push({
        field: `custom:${field.name}`,
        value: option?.id ?? null,
        confidence: decision.confidence,
        passed:
          decision.confidence >= ctx.config.jev.thresholds.customField &&
          (Boolean(option) || (!field.required && decision.value === NONE)),
        checks: { layer: 2, customFieldId: definition.id },
      });
    }
  }
  const openFields =
    schema?.openFields.filter((field) => field.kind !== "select" && field.kind !== "boolean") ?? [];
  const needsL3 =
    fields.some((field) => !field.passed) || openFields.some((field) => field.required);
  const title = templateTitle(ctx, fields, doc, documentTypeName);
  if (title) fields.push(title);
  return { fields, documentTypeName, openFields, needsL3, shortlists: lists };
}
