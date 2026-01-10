"use client";

import { Loader2 } from "lucide-react";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  RadioGroup, RadioGroupItem, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input,
} from "@repo/ui";
import type { RejectBlockType, RejectionCategory, PendingItem } from "@/lib/api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface RejectionDialogProps {
  t: TranslationFunction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PendingItem | null;
  blockType: RejectBlockType;
  setBlockType: (type: RejectBlockType) => void;
  category: RejectionCategory | null;
  setCategory: (cat: RejectionCategory | null) => void;
  reason: string;
  setReason: (r: string) => void;
  loading: boolean;
  onReject: () => void;
  onCancel: () => void;
  isBulk?: boolean;
  selectedCount?: number;
}

const REJECTION_CATEGORIES: RejectionCategory[] = [
  "duplicate", "too_generic", "irrelevant", "wrong_format", "other"
];

export function RejectionDialog({
  t, open, onOpenChange, item, blockType, setBlockType, category, setCategory,
  reason, setReason, loading, onReject, onCancel, isBulk = false, selectedCount = 0,
}: RejectionDialogProps) {
  const title = isBulk ? t("reject.bulkTitle", { count: selectedCount }) : t("reject.title");
  const description = isBulk
    ? t("reject.bulkDescription", { count: selectedCount })
    : item ? t("reject.description", { suggestion: item.suggestion }) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("reject.blockTypeLabel")}</Label>
            <RadioGroup value={blockType} onValueChange={(v) => setBlockType(v as RejectBlockType)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="none" />
                <Label htmlFor="none">{t("reject.noBlock")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="document" id="document" />
                <Label htmlFor="document">{t("reject.blockDocument")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="suggestion" id="suggestion" />
                <Label htmlFor="suggestion">{t("reject.blockSuggestion")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="both" id="both" />
                <Label htmlFor="both">{t("reject.blockBoth")}</Label>
              </div>
            </RadioGroup>
          </div>
          {blockType !== "none" && (
            <>
              <div className="space-y-2">
                <Label>{t("reject.categoryLabel")}</Label>
                <Select value={category || ""} onValueChange={(v) => setCategory(v as RejectionCategory)}>
                  <SelectTrigger><SelectValue placeholder={t("reject.selectCategory")} /></SelectTrigger>
                  <SelectContent>
                    {REJECTION_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{t(`reject.categories.${cat}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("reject.reasonLabel")}</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reject.reasonPlaceholder")} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t("reject.cancel")}</Button>
          <Button variant="destructive" onClick={onReject} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("reject.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
