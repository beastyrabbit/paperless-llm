import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogProposalContract } from "@repo/api-contracts";
import { ProposalCard, type ProposalCardHandlers } from "../components/catalog-optimization/proposal-card";
import { evidenceForProposal } from "../components/catalog-optimization/council-model";
import { catalogProposals, councilEvidence } from "../components/catalog-optimization/fixtures";

const mergeProposal = catalogProposals.find((p) => p.intendedAction === "merge");
const deleteProposal = catalogProposals.find((p) => p.intendedAction === "delete");
const renameProposal = catalogProposals.find((p) => p.intendedAction === "rename");

if (!mergeProposal || !deleteProposal || !renameProposal) {
  throw new Error("fixtures missing merge/delete/rename proposals");
}

const noopHandlers = (): ProposalCardHandlers => ({
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onApply: vi.fn(),
});

const renderCard = (proposal: CatalogProposalContract, handlers: ProposalCardHandlers = noopHandlers()) =>
  render(
    <ProposalCard
      proposal={proposal}
      evidence={evidenceForProposal(proposal, councilEvidence)}
      handlers={handlers}
    />,
  );

describe("ProposalCard — council + chair", () => {
  it("surfaces the three council opinions, chair verdict, dissent and counterexamples", () => {
    renderCard(mergeProposal);

    // Live Paperless names are rendered beside the entity ids.
    expect(screen.getByText(/Invoices \(#17\)/)).toBeInTheDocument();
    expect(screen.getByText("2 support")).toBeInTheDocument();
    expect(screen.getByText("1 oppose")).toBeInTheDocument();
    expect(screen.getByText("Needs human decision")).toBeInTheDocument();
    expect(screen.getAllByText(/counterexample/i).length).toBeGreaterThan(0);
    // The counterexample hunter's dissent is shown.
    expect(screen.getAllByText(/credit-note/i).length).toBeGreaterThan(0);
  });

  it("renders coverage meters for reviewer evidence", () => {
    renderCard(mergeProposal);
    const meters = screen.getAllByRole("meter");
    // One weakest-coverage meter + one per reviewer.
    expect(meters.length).toBeGreaterThanOrEqual(4);
  });

  it("links inspected documents to real Paperless document routes", () => {
    renderCard(mergeProposal);
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/documents/"));
    expect(links.length).toBeGreaterThan(0);
  });
});

describe("ProposalCard — human decision on a deferred proposal", () => {
  it("gates the destructive apply behind the human decision and offers approve/reject", () => {
    renderCard(mergeProposal);

    // Apply is disabled until a human decides.
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByText(/approve the proposal before applying/i)).toBeInTheDocument();

    // Human approve/reject controls are present.
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("captures a human reason and calls the approve handler", async () => {
    const handlers = noopHandlers();
    renderCard(mergeProposal, handlers);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/records a human approval/i)).toBeInTheDocument();

    // Confirm is disabled until a reason is entered.
    const confirm = within(dialog).getByRole("button", { name: "Approve" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "duplicate tag" } });
    expect(confirm).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(handlers.onApprove).toHaveBeenCalledWith(mergeProposal, "duplicate tag");
  });
});

describe("ProposalCard — destructive apply confirmation", () => {
  it("requires an explicit confirmation before an approved, fresh delete, then calls apply", async () => {
    const handlers = noopHandlers();
    renderCard(deleteProposal, handlers);

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(deleteButton).toBeEnabled();
    await act(async () => {
      fireEvent.click(deleteButton);
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /Delete now/i });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(handlers.onApply).toHaveBeenCalledWith(deleteProposal);
  });
});

describe("ProposalCard — stale proposal blocks apply", () => {
  it("disables apply and warns about a 409 / recompute for a stale proposal", () => {
    renderCard(renameProposal);

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByText(/409 conflict/i)).toBeInTheDocument();
    expect(screen.getAllByText(/recompute/i).length).toBeGreaterThan(0);
    // Freshness is surfaced as a badge.
    expect(screen.getAllByText(/stale/i).length).toBeGreaterThan(0);
  });
});
