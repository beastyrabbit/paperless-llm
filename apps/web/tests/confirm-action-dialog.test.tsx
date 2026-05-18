import { Button } from "@repo/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmActionDialog } from "../components/confirm-action-dialog";

describe("ConfirmActionDialog", () => {
  it("requires an explicit confirmation before running the action", async () => {
    const onConfirm = vi.fn();

    render(
      <ConfirmActionDialog
        title="Dangerous action"
        description="This changes production data."
        confirmLabel="Run action"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
      >
        <Button>Open confirmation</Button>
      </ConfirmActionDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open confirmation" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Dangerous action" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run action" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});
