import {
  codexStructuredOutputEffectSchemas,
  codexStructuredOutputJsonSchemas,
  type CodexChairStructuredOutput,
  type CodexReviewerStructuredOutput,
  type CouncilReviewerRole,
} from "@repo/api-contracts";
import { Effect, Schema } from "effect";
import {
  CodexRuntimeService,
  type CodexReasoningEffort,
  type CodexRunResult,
} from "../services/CodexRuntimeService.js";
import { renderStructuredPlaceholders, sanitizeJsonValue, sanitizeText, stableHash } from "./sanitizers.js";

export const CatalogOptimizationInputSchema = Schema.Struct({
  epochId: Schema.String,
  candidate: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  catalogSnapshot: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  documentEvidence: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  policy: Schema.String.pipe(Schema.optional),
});
export type CatalogOptimizationInput = Schema.Schema.Type<typeof CatalogOptimizationInputSchema>;

export const CatalogChairInputSchema = Schema.extend(
  CatalogOptimizationInputSchema,
  Schema.Struct({
    reviewerOutputs: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  }),
);
export type CatalogChairInput = Schema.Schema.Type<typeof CatalogChairInputSchema>;

export interface CatalogReviewerResult {
  readonly output: CodexReviewerStructuredOutput;
  readonly run: CodexRunResult<CodexReviewerStructuredOutput>;
}

export interface CatalogChairResult {
  readonly output: CodexChairStructuredOutput;
  readonly run: CodexRunResult<CodexChairStructuredOutput>;
}

export const CATALOG_OPTIMIZATION_PLACEHOLDERS = {
  persona: "PERSONA",
  candidate: "CANDIDATE_JSON",
  catalogSnapshot: "CATALOG_SNAPSHOT_JSON",
  documentEvidence: "DOCUMENT_EVIDENCE_JSON",
  reviewerOutputs: "REVIEWER_OUTPUTS_JSON",
  policy: "CATALOG_POLICY",
  outputSchema: "OUTPUT_SCHEMA_JSON",
} as const;

export const CatalogPersonas = {
  taxonomy_curator: {
    role: "taxonomy_curator" as CouncilReviewerRole,
    reasoningEffort: "high" as CodexReasoningEffort,
    instruction:
      "Evaluate whether the proposed taxonomy operation improves naming, grouping, and future retrieval consistency.",
  },
  document_evidence_auditor: {
    role: "document_evidence_auditor" as CouncilReviewerRole,
    reasoningEffort: "high" as CodexReasoningEffort,
    instruction:
      "Audit the supplied document receipts and evidence hashes. Oppose proposals that are not supported by representative documents.",
  },
  counterexample_hunter: {
    role: "counterexample_hunter" as CouncilReviewerRole,
    reasoningEffort: "high" as CodexReasoningEffort,
    instruction:
      "Search for documents or receipt patterns that make the proposed catalog operation unsafe, ambiguous, or overbroad.",
  },
  high_reasoning_chair: {
    role: "chair" as const,
    reasoningEffort: "xhigh" as CodexReasoningEffort,
    instruction:
      "Synthesize all reviewer evidence, enforce safety dependencies, and approve only proposals with strong agreement and no unresolved counterexamples.",
  },
} as const;

const reviewerInstructions = [
  "You are a catalog optimization council reviewer for paperless_local_llm.",
  "Return exactly one JSON object matching the reviewer schema; do not include Markdown, commentary, or extra keys.",
  "Use only the supplied candidate, catalog snapshot, document evidence, and policy.",
  "Record support, opposition, abstention, counterexamples, coverage, and receipt hashes explicitly.",
  "Do not invent IDs, hashes, counts, timestamps, or evidence documents.",
] as const;

const chairInstructions = [
  "You are the high-reasoning chair for the catalog optimization council.",
  "Return exactly one JSON object matching the chair schema; do not include Markdown, commentary, or extra keys.",
  "Approve only when the reviewer evidence supports the candidate and safety dependencies are satisfied.",
  "Reject or revise when dissent, counterexamples, hash mismatches, or insufficient coverage create risk.",
  "Do not invent IDs, hashes, counts, timestamps, or candidate relationships.",
] as const;

const reviewerTemplate = `${reviewerInstructions.join("\n")}

PERSONA:
{{PERSONA}}

CANDIDATE:
{{CANDIDATE_JSON}}

CATALOG SNAPSHOT:
{{CATALOG_SNAPSHOT_JSON}}

DOCUMENT EVIDENCE:
{{DOCUMENT_EVIDENCE_JSON}}

POLICY:
{{CATALOG_POLICY}}

OUTPUT JSON SCHEMA:
{{OUTPUT_SCHEMA_JSON}}
`;

const chairTemplate = `${chairInstructions.join("\n")}

PERSONA:
{{PERSONA}}

CANDIDATE:
{{CANDIDATE_JSON}}

CATALOG SNAPSHOT:
{{CATALOG_SNAPSHOT_JSON}}

DOCUMENT EVIDENCE:
{{DOCUMENT_EVIDENCE_JSON}}

REVIEWER OUTPUTS:
{{REVIEWER_OUTPUTS_JSON}}

POLICY:
{{CATALOG_POLICY}}

OUTPUT JSON SCHEMA:
{{OUTPUT_SCHEMA_JSON}}
`;

export const buildCatalogReviewerPrompt = (
  input: CatalogOptimizationInput,
  persona: Exclude<keyof typeof CatalogPersonas, "high_reasoning_chair">,
): string =>
  renderStructuredPlaceholders(reviewerTemplate, {
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.persona]: sanitizeText(
      `${CatalogPersonas[persona].role}: ${CatalogPersonas[persona].instruction}`,
    ),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.candidate]: sanitizeJsonValue(input.candidate),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.catalogSnapshot]: sanitizeJsonValue(input.catalogSnapshot),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.documentEvidence]: sanitizeJsonValue(input.documentEvidence),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.policy]: sanitizeText(input.policy ?? "No additional policy."),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.outputSchema]: sanitizeJsonValue(codexStructuredOutputJsonSchemas.reviewer),
  });

export const buildCatalogChairPrompt = (input: CatalogChairInput): string =>
  renderStructuredPlaceholders(chairTemplate, {
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.persona]: sanitizeText(
      `${CatalogPersonas.high_reasoning_chair.role}: ${CatalogPersonas.high_reasoning_chair.instruction}`,
    ),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.candidate]: sanitizeJsonValue(input.candidate),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.catalogSnapshot]: sanitizeJsonValue(input.catalogSnapshot),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.documentEvidence]: sanitizeJsonValue(input.documentEvidence),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.reviewerOutputs]: sanitizeJsonValue(input.reviewerOutputs),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.policy]: sanitizeText(input.policy ?? "No additional policy."),
    [CATALOG_OPTIMIZATION_PLACEHOLDERS.outputSchema]: sanitizeJsonValue(codexStructuredOutputJsonSchemas.chair),
  });

export const CatalogOptimizationSkill = {
  name: "CatalogOptimizationSkill",
  schemas: {
    reviewer: codexStructuredOutputEffectSchemas.reviewer,
    chair: codexStructuredOutputEffectSchemas.chair,
  },
  jsonSchemas: {
    reviewer: codexStructuredOutputJsonSchemas.reviewer,
    chair: codexStructuredOutputJsonSchemas.chair,
  },
  personas: CatalogPersonas,
  instructions: {
    reviewer: reviewerInstructions,
    chair: chairInstructions,
  },
  placeholders: CATALOG_OPTIMIZATION_PLACEHOLDERS,
  inputHash: (input: CatalogOptimizationInput | CatalogChairInput): string => stableHash(input),
  buildReviewerPrompt: buildCatalogReviewerPrompt,
  buildChairPrompt: buildCatalogChairPrompt,
  runReviewer: (
    input: CatalogOptimizationInput,
    persona: Exclude<keyof typeof CatalogPersonas, "high_reasoning_chair">,
    options: { readonly timeoutMs?: number } = {},
  ): Effect.Effect<CatalogReviewerResult, unknown, CodexRuntimeService> =>
    Effect.gen(function* () {
      const runtime = yield* CodexRuntimeService;
      const run = yield* runtime.runStructured({
        prompt: buildCatalogReviewerPrompt(input, persona),
        schema: codexStructuredOutputEffectSchemas.reviewer,
        jsonSchema: codexStructuredOutputJsonSchemas.reviewer,
        structuredOutputKind: "reviewer",
        reasoningEffort: CatalogPersonas[persona].reasoningEffort,
        timeoutMs: options.timeoutMs,
      });
      return { output: run.output, run };
    }),
  runChair: (
    input: CatalogChairInput,
    options: { readonly timeoutMs?: number } = {},
  ): Effect.Effect<CatalogChairResult, unknown, CodexRuntimeService> =>
    Effect.gen(function* () {
      const runtime = yield* CodexRuntimeService;
      const run = yield* runtime.runStructured({
        prompt: buildCatalogChairPrompt(input),
        schema: codexStructuredOutputEffectSchemas.chair,
        jsonSchema: codexStructuredOutputJsonSchemas.chair,
        structuredOutputKind: "chair",
        reasoningEffort: CatalogPersonas.high_reasoning_chair.reasoningEffort,
        timeoutMs: options.timeoutMs,
      });
      return { output: run.output, run };
    }),
} as const;
