/**
 * Evidence hierarchy for a proposal: each proposed field is grounded in OCR
 * block references (page / block / quote hash) with a rationale and confidence.
 * New tag candidates are surfaced distinctly since they change the catalog.
 */
import type { AnalysisFieldEvidence, AnalysisProposal } from "@repo/api-contracts";
import { confidenceTone, formatConfidence } from "./analysis-model";
import { HashChip, StatusBadge } from "./ui";

const FIELD_LABEL: Record<AnalysisFieldEvidence["field"], string> = {
  title: "Title",
  correspondent: "Correspondent",
  document_type: "Document type",
  ordinary_tags: "Tags",
  new_tag_candidates: "New tag candidates",
  custom_field: "Custom field",
};

function EvidenceReferences({ references }: { references: AnalysisFieldEvidence["references"] }) {
  return (
    <ul className="mt-2 space-y-1">
      {references.map((reference) => (
        <li
          key={`${reference.pageNumber}-${reference.blockId}`}
          className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"
        >
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            p.{reference.pageNumber}
          </span>
          <code className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{reference.blockId}</code>
          <HashChip hash={reference.quoteHash} label="quote hash" />
        </li>
      ))}
    </ul>
  );
}

function EvidenceItem({ evidence, name }: { evidence: AnalysisFieldEvidence; name: string }) {
  return (
    <div className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{name}</span>
        <StatusBadge tone={confidenceTone(evidence.confidence)}>
          {formatConfidence(evidence.confidence)} confidence
        </StatusBadge>
      </div>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{evidence.rationale}</p>
      <EvidenceReferences references={evidence.references} />
    </div>
  );
}

export function EvidencePanel({ proposal }: { proposal: AnalysisProposal }) {
  const { newTagCandidates } = proposal.proposed;

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {proposal.fieldEvidence.map((evidence) => (
          <EvidenceItem
            key={`${evidence.field}-${evidence.customFieldId ?? "-"}`}
            evidence={evidence}
            name={FIELD_LABEL[evidence.field]}
          />
        ))}
      </div>

      {newTagCandidates.length > 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
            New tag candidates
          </h3>
          <ul className="mt-2 space-y-3">
            {newTagCandidates.map((candidate) => (
              <li key={candidate.candidateKey}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {candidate.color ? (
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-black/10"
                        style={{ backgroundColor: candidate.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {candidate.name}
                  </span>
                  <StatusBadge tone={confidenceTone(candidate.confidence)}>
                    {formatConfidence(candidate.confidence)} confidence
                  </StatusBadge>
                </div>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{candidate.rationale}</p>
                <EvidenceReferences references={candidate.evidence} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
