import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  analysisProposal,
  documentBaseline,
  entityLabels,
} from "../components/workbench/fixtures";
import { MetadataDiff } from "../components/workbench/metadata-diff";
import { RunTimeline } from "../components/workbench/run-timeline";

describe("MetadataDiff", () => {
  it("renders before/after values and change labels", () => {
    render(
      <MetadataDiff baseline={documentBaseline} proposal={analysisProposal} labels={entityLabels} />,
    );

    // Proposed correspondent (added) is shown.
    expect(screen.getByText("Stadtwerke München")).toBeInTheDocument();
    // Retained + newly added tags are both present (names can repeat across columns).
    expect(screen.getAllByText("Utilities").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Invoice").length).toBeGreaterThan(0);
    expect(screen.getByText("Tax-relevant")).toBeInTheDocument();
    // Change classification labels appear.
    expect(screen.getAllByText("Added").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Changed").length).toBeGreaterThan(0);
  });

  it("exposes each field row with an accessible header", () => {
    render(
      <MetadataDiff baseline={documentBaseline} proposal={analysisProposal} labels={entityLabels} />,
    );
    expect(screen.getByRole("rowheader", { name: /Title/ })).toBeInTheDocument();
    const meters = screen.getAllByRole("meter");
    expect(meters.length).toBeGreaterThan(0);
  });
});

describe("RunTimeline", () => {
  it("renders the pipeline with an in-progress current step", () => {
    render(<RunTimeline run={{ state: "awaiting_review", forceOcr: false }} />);
    const list = screen.getByRole("list");
    expect(within(list).getByText("Awaiting review")).toBeInTheDocument();
    // The current step exposes its status as text (visible + sr-only).
    expect(within(list).getAllByText(/in progress/i).length).toBeGreaterThan(0);
  });

  it("labels a skipped OCR step for non-forced runs", () => {
    render(<RunTimeline run={{ state: "analyzing", forceOcr: false }} />);
    expect(screen.getByText("OCR requested")).toBeInTheDocument();
  });
});
