"use client";

import { useState } from "react";
import {
  CheckCircle2,
  User,
  Tag,
  FileText,
  Check,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PendingItem {
  id: number;
  docId: number;
  docTitle: string;
  type: "correspondent" | "document_type" | "tag";
  suggestion: string;
  reasoning: string;
  alternatives: string[];
  attempts: number;
  lastFeedback?: string;
  createdAt: string;
}

const mockPendingItems: PendingItem[] = [
  {
    id: 1,
    docId: 5,
    docTitle: "Scan vom 15. Januar 2024",
    type: "correspondent",
    suggestion: "Stadtwerke München",
    reasoning:
      "The document header shows 'Stadtwerke München GmbH' letterhead with their official logo. The document is an electricity bill addressed to the user.",
    alternatives: ["SWM - Stadtwerke München", "Stadtwerke"],
    attempts: 2,
    lastFeedback:
      "The correspondent name should match exactly what's in the letterhead to avoid duplicates.",
    createdAt: "2024-01-15T10:30:00Z",
  },
  {
    id: 2,
    docId: 7,
    docTitle: "Amazon Order Confirmation",
    type: "document_type",
    suggestion: "Invoice",
    reasoning:
      "The document contains itemized purchases with prices and a total amount. It has order numbers and billing information typical of invoices.",
    alternatives: ["Receipt", "Order Confirmation"],
    attempts: 1,
    createdAt: "2024-01-15T11:45:00Z",
  },
  {
    id: 3,
    docId: 12,
    docTitle: "Mietvertrag Wohnung",
    type: "document_type",
    suggestion: "Contract",
    reasoning:
      "This is a rental agreement document with terms, conditions, and signatures from both parties. It establishes a legal relationship between landlord and tenant.",
    alternatives: ["Agreement", "Rental Agreement", "Legal Document"],
    attempts: 1,
    lastFeedback:
      "Consider using a more specific document type for rental contracts.",
    createdAt: "2024-01-14T16:20:00Z",
  },
];

const sections = [
  { key: "correspondent", label: "Correspondents", icon: User },
  { key: "document_type", label: "Document Types", icon: FileText },
  { key: "tag", label: "Tags", icon: Tag },
] as const;

type SectionKey = (typeof sections)[number]["key"];

export default function PendingPage() {
  const [items, setItems] = useState<PendingItem[]>(mockPendingItems);
  const [activeSection, setActiveSection] = useState<SectionKey>("correspondent");
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(
    new Set()
  );

  const getCount = (type: SectionKey) =>
    items.filter((item) => item.type === type).length;

  const totalCount = items.length;

  const filteredItems = items.filter((item) => item.type === activeSection);

  const handleSelectOption = (id: number, option: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        // Swap: move current suggestion to alternatives, remove new selection from alternatives
        const newAlternatives = [
          item.suggestion,
          ...item.alternatives.filter((alt) => alt !== option),
        ];
        return { ...item, suggestion: option, alternatives: newAlternatives };
      })
    );
  };

  const handleApprove = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleReject = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const toggleReasoning = (id: number) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getFirstSentence = (text: string) => {
    const match = text.match(/^[^.!?]+[.!?]/);
    return match ? match[0] : text;
  };

  // Auto-switch to first non-empty section if current is empty
  const currentCount = getCount(activeSection);
  if (currentCount === 0 && totalCount > 0) {
    const firstNonEmpty = sections.find((s) => getCount(s.key) > 0);
    if (firstNonEmpty && firstNonEmpty.key !== activeSection) {
      setActiveSection(firstNonEmpty.key);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Pending Review</h1>
            <p className="text-sm text-zinc-500">
              {totalCount} items requiring your approval
            </p>
          </div>
        </div>
      </header>

      <div className="p-8">
        {/* Section Tabs */}
        <div className="flex gap-2 mb-6">
          {sections.map((section) => {
            const count = getCount(section.key);
            const Icon = section.icon;
            const isActive = activeSection === section.key;
            const isDisabled = count === 0;

            return (
              <Button
                key={section.key}
                variant={isActive ? "default" : "outline"}
                disabled={isDisabled}
                onClick={() => setActiveSection(section.key)}
                className={cn(
                  "gap-2",
                  isDisabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <Icon className="h-4 w-4" />
                {section.label}
                <Badge
                  variant={isActive ? "secondary" : "outline"}
                  className={cn(
                    "ml-1 min-w-[1.5rem] justify-center",
                    isDisabled && "bg-zinc-100 dark:bg-zinc-800"
                  )}
                >
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>

        {/* Content */}
        {totalCount === 0 ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
              <h3 className="text-lg font-medium">All caught up!</h3>
              <p className="text-zinc-500 mt-1">No items pending your review</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const allOptions = [item.suggestion, ...item.alternatives];
              const firstSentence = getFirstSentence(item.reasoning);
              const hasMore = item.reasoning.length > firstSentence.length;
              const isExpanded = expandedReasoning.has(item.id);

              return (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    {/* Top row: Document title + attempt badge */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {item.docTitle}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Attempt {item.attempts}
                      </Badge>
                    </div>

                    {/* Options row */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {allOptions.map((option) => {
                        const isSelected = option === item.suggestion;
                        return (
                          <Button
                            key={option}
                            variant="outline"
                            size="sm"
                            className={cn(
                              "transition-all",
                              isSelected &&
                                "border-emerald-500 border-2 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                            )}
                            onClick={() => handleSelectOption(item.id, option)}
                          >
                            {isSelected && (
                              <Check className="h-3 w-3 mr-1 text-emerald-600" />
                            )}
                            {option}
                          </Button>
                        );
                      })}
                    </div>

                    {/* Reasoning */}
                    <div className="mb-3">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {isExpanded ? item.reasoning : firstSentence}
                        {hasMore && !isExpanded && (
                          <button
                            onClick={() => toggleReasoning(item.id)}
                            className="ml-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                          >
                            more...
                          </button>
                        )}
                        {isExpanded && hasMore && (
                          <button
                            onClick={() => toggleReasoning(item.id)}
                            className="ml-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                          >
                            less
                          </button>
                        )}
                      </p>
                      {item.lastFeedback && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 italic mt-1">
                          Feedback: {item.lastFeedback}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-zinc-500 hover:text-red-600"
                        onClick={() => handleReject(item.id)}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleApprove(item.id)}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
