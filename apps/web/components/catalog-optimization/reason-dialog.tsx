/**
 * Confirmation dialog that captures a human reason before a decision command
 * (approve / reject). A reason is required and sent with the request; the
 * backend records only a hash of it (request-scoped) — the free text is not
 * persisted verbatim in any ledger.
 */
"use client";

import {
  Button,
  type ButtonProps,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Textarea,
} from "@repo/ui";
import { type ReactNode, useId, useState } from "react";

interface ReasonDialogProps {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (reason: string) => Promise<void> | void;
  confirmVariant?: ButtonProps["variant"];
  reasonRequired?: boolean;
  disabled?: boolean;
}

export function ReasonDialog({
  children,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  confirmVariant = "default",
  reasonRequired = false,
  disabled = false,
}: ReasonDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const fieldId = useId();
  const canConfirm = !disabled && (!reasonRequired || reason.trim().length > 0);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    await onConfirm(reason);
    setReason("");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>
            Reason{reasonRequired ? "" : " (optional)"}
          </Label>
          <Textarea
            id={fieldId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this decision being recorded?"
            rows={3}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button type="button" variant={confirmVariant} onClick={handleConfirm} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
