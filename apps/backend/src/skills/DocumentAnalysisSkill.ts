import {
  type CodexDocumentStructuredOutput,
  codexStructuredOutputEffectSchemas,
  codexStructuredOutputJsonSchemas,
  type StrictDecodeError,
  strictDecodeAnalysisProposal,
} from "@repo/api-contracts";
import { Effect, Schema } from "effect";
import {
  type CodexReasoningEffort,
  type CodexRunResult,
  CodexRuntimeError,
  CodexRuntimeService,
  isStructuredOutputInvalid,
} from "../services/CodexRuntimeService.js";
import {
  renderStructuredPlaceholders,
  sanitizeJsonValue,
  sanitizeText,
  stableHash,
} from "./sanitizers.js";

export const DocumentAnalysisInputSchema = Schema.Struct({
  runId: Schema.String,
  documentId: Schema.Number,
  documentState: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ocrPreview: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  catalogSnapshot: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  configuredCustomFieldIds: Schema.Array(Schema.Number),
  policy: Schema.Struct({
    forbiddenWorkflowTagIds: Schema.Array(Schema.Number).pipe(Schema.optional),
    forbiddenSystemTagIds: Schema.Array(Schema.Number).pipe(Schema.optional),
  }).pipe(Schema.optional),
  guidance: Schema.String.pipe(Schema.optional),
});
export type DocumentAnalysisInput = Schema.Schema.Type<typeof DocumentAnalysisInputSchema>;

export interface DocumentAnalysisResult {
  readonly output: CodexDocumentStructuredOutput;
  readonly repaired: boolean;
  readonly run: CodexRunResult<CodexDocumentStructuredOutput>;
  readonly strictProposalErrors: readonly StrictDecodeError[];
}

export const DOCUMENT_ANALYSIS_PLACEHOLDERS = {
  engineIdentity: "ENGINE_IDENTITY_JSON",
  documentState: "DOCUMENT_STATE_JSON",
  ocrPreview: "OCR_PREVIEW_JSON",
  catalogSnapshot: "CATALOG_SNAPSHOT_JSON",
  policy: "ANALYSIS_POLICY_JSON",
  guidance: "HUMAN_GUIDANCE",
  outputSchema: "OUTPUT_SCHEMA_JSON",
} as const;

const documentAnalysisInstructions = [
  "You are the document analysis skill for paperless_local_llm.",
  "Return exactly one JSON object matching the supplied schema; do not include Markdown, commentary, or extra keys.",
  "Use only the supplied OCR preview, document state, catalog snapshot, and human guidance.",
  "Every Paperless tag, correspondent, document type, and custom field in the catalog snapshot is available for use; do not apply hidden allowlists.",
  "Prefer existing catalog entities when evidence supports them, and mark review.required when evidence is weak or conflicting.",
  "Before choosing tags, compare every existing tag name with the document title, original filename, and OCR evidence.",
  "An exact or high-confidence identity match for an organization, product, project, property, or client (for example SKYWAY) should normally be selected in addition to topical tags; omit it only when cited evidence shows the match is incidental.",
  "When tag-count pressure exists, a supported identity tag outranks broad topical tags such as finance, payment, bank, business, or credit.",
  "ordinaryTagIds is the complete final ordinary-tag set. Never include the transient ai-analyse trigger tag.",
  "Return one explicit set or remove decision for every custom field supplied in the catalog snapshot, using its data type and document evidence.",
  "Treat each custom-field name as a semantic instruction. In particular, a field named Echter Korrespondent represents the contextual business/client/entity the document concerns and may differ from the physical sender stored as Paperless correspondent.",
  "Use strong title, filename, and OCR identity evidence to set Echter Korrespondent independently; do not remove it merely because the physical sender has been selected as correspondent.",
  "Every proposed metadata field must be backed by explicit evidence references and hash preconditions.",
  "Do not invent document IDs, tag IDs, custom-field IDs, hashes, or timestamps; use supplied placeholders and state.",
] as const;

const documentAnalysisTemplate = `${documentAnalysisInstructions.join("\n")}

ENGINE IDENTITY:
{{ENGINE_IDENTITY_JSON}}

DOCUMENT STATE:
{{DOCUMENT_STATE_JSON}}

OCR PREVIEW:
{{OCR_PREVIEW_JSON}}

CATALOG SNAPSHOT:
{{CATALOG_SNAPSHOT_JSON}}

ANALYSIS POLICY:
{{ANALYSIS_POLICY_JSON}}

HUMAN GUIDANCE:
{{HUMAN_GUIDANCE}}

OUTPUT JSON SCHEMA:
{{OUTPUT_SCHEMA_JSON}}
`;

const repairTemplate = `Repair this invalid document structured output.
Return exactly one JSON object matching the same document output schema.
Preserve valid evidence, hashes, IDs, and decisions from the candidate when they satisfy the schema.
Change only fields required to satisfy the schema and the stated validation failure.

VALIDATION FAILURE:
{{VALIDATION_FAILURE}}

CANDIDATE OUTPUT:
{{CANDIDATE_OUTPUT_JSON}}

ORIGINAL TASK:
{{ORIGINAL_TASK}}

OUTPUT JSON SCHEMA:
{{OUTPUT_SCHEMA_JSON}}
`;

export const buildDocumentAnalysisPrompt = (input: DocumentAnalysisInput): string =>
  renderStructuredPlaceholders(documentAnalysisTemplate, {
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.engineIdentity]: sanitizeJsonValue({
      runId: input.runId,
      documentId: input.documentId,
    }),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.documentState]: sanitizeJsonValue(input.documentState),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.ocrPreview]: sanitizeJsonValue(input.ocrPreview),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.catalogSnapshot]: sanitizeJsonValue(input.catalogSnapshot),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.policy]: sanitizeJsonValue(input.policy ?? {}),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.guidance]: sanitizeText(
      input.guidance ?? "No additional guidance.",
    ),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.outputSchema]: sanitizeJsonValue(
      codexStructuredOutputJsonSchemas.document,
    ),
  });

const buildRepairPrompt = (
  originalPrompt: string,
  validationFailure: unknown,
  candidateOutput: unknown = null,
): string =>
  renderStructuredPlaceholders(repairTemplate, {
    VALIDATION_FAILURE:
      typeof validationFailure === "string"
        ? sanitizeText(validationFailure, 4_000)
        : sanitizeJsonValue(validationFailure, 8_000),
    CANDIDATE_OUTPUT_JSON: sanitizeJsonValue(candidateOutput, 40_000),
    ORIGINAL_TASK: sanitizeText(originalPrompt, 50_000),
    [DOCUMENT_ANALYSIS_PLACEHOLDERS.outputSchema]: sanitizeJsonValue(
      codexStructuredOutputJsonSchemas.document,
    ),
  });

const forbiddenTagErrors = (
  output: CodexDocumentStructuredOutput,
  input: DocumentAnalysisInput,
): readonly StrictDecodeError[] => {
  const forbiddenWorkflowTagIds = new Set(input.policy?.forbiddenWorkflowTagIds ?? []);
  const forbiddenSystemTagIds = new Set(input.policy?.forbiddenSystemTagIds ?? []);
  const errors: StrictDecodeError[] = [];
  for (const tagId of output.proposal.proposed.ordinaryTagIds) {
    if (forbiddenWorkflowTagIds.has(tagId)) {
      errors.push({
        code: "FORBIDDEN_FIELDS",
        message: `Forbidden workflow tag selected: ${tagId}`,
        path: ["proposal", "proposed", "ordinaryTagIds"],
      });
    }
    if (forbiddenSystemTagIds.has(tagId)) {
      errors.push({
        code: "FORBIDDEN_FIELDS",
        message: `Forbidden system tag selected: ${tagId}`,
        path: ["proposal", "proposed", "ordinaryTagIds"],
      });
    }
  }
  return errors;
};

const validateSemanticOutput = (
  output: CodexDocumentStructuredOutput,
  input: DocumentAnalysisInput,
): readonly StrictDecodeError[] => {
  const result = strictDecodeAnalysisProposal(output.proposal, input.configuredCustomFieldIds);
  return [...(result.ok ? [] : result.errors), ...forbiddenTagErrors(output, input)];
};

const canonicalizeEngineIdentity = (
  output: CodexDocumentStructuredOutput,
  input: DocumentAnalysisInput,
): CodexDocumentStructuredOutput => ({
  ...output,
  runId: input.runId as CodexDocumentStructuredOutput["runId"],
  documentId: input.documentId as CodexDocumentStructuredOutput["documentId"],
  proposal: {
    ...output.proposal,
    runId: input.runId as CodexDocumentStructuredOutput["proposal"]["runId"],
    documentId: input.documentId as CodexDocumentStructuredOutput["proposal"]["documentId"],
  },
});

const semanticFailure = (errors: readonly StrictDecodeError[]): CodexRuntimeError =>
  new CodexRuntimeError({
    code: "CODEX_STRUCTURED_OUTPUT_INVALID",
    message: "Codex document output failed semantic proposal validation.",
    details: { errors },
  });

export const DocumentAnalysisSkill = {
  name: "DocumentAnalysisSkill",
  schema: codexStructuredOutputEffectSchemas.document,
  jsonSchema: codexStructuredOutputJsonSchemas.document,
  instructions: documentAnalysisInstructions,
  placeholders: DOCUMENT_ANALYSIS_PLACEHOLDERS,
  inputHash: (input: DocumentAnalysisInput): string => stableHash(input),
  buildPrompt: buildDocumentAnalysisPrompt,
  run: (
    input: DocumentAnalysisInput,
    options: { readonly reasoningEffort?: CodexReasoningEffort; readonly timeoutMs?: number } = {},
  ): Effect.Effect<DocumentAnalysisResult, unknown, CodexRuntimeService> =>
    Effect.gen(function* () {
      const runtime = yield* CodexRuntimeService;
      const prompt = buildDocumentAnalysisPrompt(input);
      const request = {
        prompt,
        schema: codexStructuredOutputEffectSchemas.document,
        jsonSchema: codexStructuredOutputJsonSchemas.document,
        structuredOutputKind: "document" as const,
        reasoningEffort: options.reasoningEffort ?? "medium",
        timeoutMs: options.timeoutMs,
      };

      const first = yield* Effect.either(runtime.runStructured(request));
      if (first._tag === "Left" && !isStructuredOutputInvalid(first.left)) {
        return yield* Effect.fail(first.left);
      }

      const firstOutput =
        first._tag === "Right" ? canonicalizeEngineIdentity(first.right.output, input) : null;
      const firstSemanticErrors =
        firstOutput === null ? [] : validateSemanticOutput(firstOutput, input);
      const firstValid = first._tag === "Right" && firstSemanticErrors.length === 0;
      if (firstValid && firstOutput) {
        return {
          output: firstOutput,
          repaired: false,
          run: { ...first.right, output: firstOutput },
          strictProposalErrors: [],
        };
      }

      const validationFailure =
        first._tag === "Left" ? first.left : semanticFailure(firstSemanticErrors);
      const candidateOutput = firstOutput;
      const run = yield* runtime.runStructured({
        ...request,
        prompt: buildRepairPrompt(prompt, validationFailure, candidateOutput),
      });
      const repairedOutput = canonicalizeEngineIdentity(run.output, input);
      const repairedSemanticErrors = validateSemanticOutput(repairedOutput, input);
      if (repairedSemanticErrors.length > 0) {
        return yield* Effect.fail(semanticFailure(repairedSemanticErrors));
      }

      return {
        output: repairedOutput,
        repaired: true,
        run: { ...run, output: repairedOutput },
        strictProposalErrors: [],
      };
    }),
} as const;
