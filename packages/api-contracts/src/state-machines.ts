import { Schema } from "effect";

export const AnalysisRunStateSchema = Schema.Literal(
  "queued",
  "reading_paperless",
  "ocr_requested",
  "hashing_source",
  "analyzing",
  "awaiting_review",
  "approved",
  "rejected",
  "retrying",
  "applying",
  "succeeded",
  "failed",
  "canceled",
).annotations({ identifier: "AnalysisRunState" });
export type AnalysisRunState = Schema.Schema.Type<typeof AnalysisRunStateSchema>;

export const CatalogStateSchema = Schema.Literal(
  "queued",
  "collecting",
  "evidence_ready",
  "council_review",
  "proposed",
  "approved",
  "rejected",
  "applying",
  "applied",
  "failed",
  "canceled",
).annotations({ identifier: "CatalogState" });
export type CatalogState = Schema.Schema.Type<typeof CatalogStateSchema>;

export const AnalysisStateTransitionSchema = Schema.Struct({
  from: AnalysisRunStateSchema,
  to: AnalysisRunStateSchema,
}).annotations({ identifier: "AnalysisStateTransition" });

export const CatalogStateTransitionSchema = Schema.Struct({
  from: CatalogStateSchema,
  to: CatalogStateSchema,
}).annotations({ identifier: "CatalogStateTransition" });

export const StateTransitionConflictSchema = Schema.Struct({
  status: Schema.Literal(409),
  code: Schema.Literal("STATE_TRANSITION_CONFLICT"),
  message: Schema.String,
  current: Schema.String,
  expected: Schema.String,
  requested: Schema.String,
}).annotations({ identifier: "StateTransitionConflict" });
export type StateTransitionConflict = Schema.Schema.Type<typeof StateTransitionConflictSchema>;

export const analysisRunTransitions = {
  queued: ["reading_paperless", "ocr_requested", "canceled"],
  reading_paperless: ["hashing_source", "ocr_requested", "failed", "canceled"],
  ocr_requested: ["hashing_source", "failed", "canceled"],
  hashing_source: ["analyzing", "failed", "canceled"],
  analyzing: ["awaiting_review", "failed", "canceled"],
  awaiting_review: ["approved", "rejected", "retrying", "failed", "canceled"],
  approved: ["applying", "failed", "canceled"],
  rejected: [],
  retrying: ["reading_paperless", "ocr_requested", "failed", "canceled"],
  applying: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
} as const satisfies Record<AnalysisRunState, readonly AnalysisRunState[]>;

export const catalogTransitions = {
  queued: ["collecting", "canceled"],
  collecting: ["evidence_ready", "failed", "canceled"],
  evidence_ready: ["council_review", "proposed", "failed", "canceled"],
  council_review: ["proposed", "failed", "canceled"],
  proposed: ["approved", "rejected", "failed", "canceled"],
  approved: ["applying", "failed", "canceled"],
  rejected: [],
  applying: ["applied", "failed", "canceled"],
  applied: [],
  failed: [],
  canceled: [],
} as const satisfies Record<CatalogState, readonly CatalogState[]>;

type TransitionResult<State extends string> =
  | { ok: true; state: State }
  | { ok: false; state: State; error: StateTransitionConflict };

const stateTransitionConflict = <State extends string>(
  current: State,
  expected: State,
  requested: State,
): StateTransitionConflict => ({
  status: 409,
  code: "STATE_TRANSITION_CONFLICT",
  message:
    current !== expected
      ? `State compare-and-set failed: expected ${expected}, found ${current}.`
      : `Illegal state transition from ${current} to ${requested}.`,
  current,
  expected,
  requested,
});

const compareAndSetState = <State extends string>(
  transitions: Record<State, readonly State[]>,
  current: State,
  expected: State,
  next: State,
): TransitionResult<State> => {
  if (current !== expected) {
    return { ok: false, state: current, error: stateTransitionConflict(current, expected, next) };
  }
  if (!transitions[current].includes(next)) {
    return { ok: false, state: current, error: stateTransitionConflict(current, expected, next) };
  }
  return { ok: true, state: next };
};

export const isLegalAnalysisRunTransition = (from: AnalysisRunState, to: AnalysisRunState) =>
  (analysisRunTransitions[from] as readonly AnalysisRunState[]).includes(to);

export const isLegalCatalogTransition = (from: CatalogState, to: CatalogState) =>
  (catalogTransitions[from] as readonly CatalogState[]).includes(to);

export const compareAndSetAnalysisRunState = (
  current: AnalysisRunState,
  expected: AnalysisRunState,
  next: AnalysisRunState,
): TransitionResult<AnalysisRunState> =>
  compareAndSetState(analysisRunTransitions, current, expected, next);

export const compareAndSetCatalogState = (
  current: CatalogState,
  expected: CatalogState,
  next: CatalogState,
): TransitionResult<CatalogState> => compareAndSetState(catalogTransitions, current, expected, next);
