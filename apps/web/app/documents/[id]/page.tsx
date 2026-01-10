"use client";

import { useState, useEffect, use } from "react";
import {
  ArrowLeft,
  Play,
  FileText,
  User,
  Loader2,
  Sparkles,
  Calendar,
  Tag,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ScrollArea,
  Separator,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui";
import Link from "next/link";
import { documentsApi, type DocumentDetail } from "@/lib/api";

// Helper to determine processing status from tags
function getProcessingStatus(tags: Array<{ id: number; name: string }>): string {
  const tagNames = tags.map((t) => t.name);
  if (tagNames.some((t) => t.includes("processed"))) return "processed";
  if (tagNames.some((t) => t.includes("tags-done"))) return "tags_done";
  if (tagNames.some((t) => t.includes("document-type-done"))) return "document_type_done";
  if (tagNames.some((t) => t.includes("correspondent-done"))) return "correspondent_done";
  if (tagNames.some((t) => t.includes("title-done"))) return "title_done";
  if (tagNames.some((t) => t.includes("ocr-done"))) return "ocr_done";
  if (tagNames.some((t) => t.includes("pending"))) return "pending";
  return "unknown";
}

// Check if OCR is done (content accordion should be collapsed)
function isOcrComplete(status: string): boolean {
  return !["pending", "unknown"].includes(status);
}

// Get the next processing step based on current status
function getNextStep(status: string): { step: string; label: string } | null {
  switch (status) {
    case "pending":
    case "unknown":
      return { step: "ocr", label: "OCR" };
    case "ocr_done":
      return { step: "title", label: "Title" };
    case "title_done":
      return { step: "correspondent", label: "Correspondent" };
    case "correspondent_done":
      return { step: "document_type", label: "Document Type" };
    case "document_type_done":
      return { step: "tags", label: "Tags" };
    case "tags_done":
      return { step: "custom_fields", label: "Custom Fields" };
    case "processed":
      return null; // Already fully processed
    default:
      return { step: "title", label: "Title" };
  }
}

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const docId = parseInt(resolvedParams.id);

  // Document state
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Content accordion - open if OCR not complete
  const [contentAccordionValue, setContentAccordionValue] = useState<string[]>([]);

  // Fetch document on mount
  useEffect(() => {
    async function fetchDocument() {
      setLoading(true);
      const { data, error } = await documentsApi.get(docId);
      if (error) {
        setError(error);
      } else if (data) {
        setDocument(data);
        // Set initial content accordion state based on processing status
        const status = getProcessingStatus(data.tags);
        if (!isOcrComplete(status)) {
          setContentAccordionValue(["content"]);
        }
      }
      setLoading(false);
    }
    fetchDocument();
  }, [docId]);

  const processingStatus = document ? getProcessingStatus(document.tags) : "unknown";
  const nextStep = getNextStep(processingStatus);
  const isProcessed = processingStatus === "processed";
  const pdfUrl = documentsApi.getPdfUrl(docId);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
        <p className="text-red-500">{error || "Document not found"}</p>
        <Link href="/documents">
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Documents
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <Link href="/documents">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Document #{docId}
              </h1>
              <div className="flex items-center gap-2">
                <p className="text-sm text-zinc-500 truncate max-w-md">{document.title}</p>
                <Badge variant="outline" className="text-xs">
                  {processingStatus.replace(/_/g, " ")}
                </Badge>
              </div>
            </div>
          </div>
          <Button
            asChild
            variant={isProcessed ? "secondary" : "default"}
            disabled={isProcessed}
          >
            <Link href={`/documents/${docId}/process`}>
              {isProcessed ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Fully Processed
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run {nextStep?.label ?? "Next"} Step
                  <ExternalLink className="ml-2 h-3 w-3" />
                </>
              )}
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-6 p-8">
        {/* Main content area - PDF left, info right */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* PDF Viewer - Left Column */}
          <Card className="lg:row-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Document Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <iframe
                src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                className="h-[1000px] w-full rounded-b-lg border-t"
                title={`Document ${docId} PDF`}
              />
            </CardContent>
          </Card>

          {/* Right Column - Content Accordion + Info */}
          <div className="flex flex-col gap-6">
            {/* Document Content Accordion */}
            <Card>
              <Accordion
                type="multiple"
                value={contentAccordionValue}
                onValueChange={setContentAccordionValue}
              >
                <AccordionItem value="content" className="border-0">
                  <CardHeader className="py-4">
                    <AccordionTrigger className="hover:no-underline [&[data-state=open]>svg]:rotate-180">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FileText className="h-4 w-4" />
                        OCR Content
                        {isOcrComplete(processingStatus) && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            Extracted
                          </Badge>
                        )}
                      </CardTitle>
                    </AccordionTrigger>
                  </CardHeader>
                  <AccordionContent>
                    <CardContent className="pt-0 pb-4">
                      <ScrollArea className="h-[200px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <pre className="whitespace-pre-wrap font-mono text-sm">
                          {document.content || "No content available"}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </Card>

            {/* Document Info Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Document Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Title */}
                <div>
                  <p className="text-sm text-zinc-500">Title</p>
                  <p className="font-medium">{document.title}</p>
                </div>

                <Separator />

                {/* Correspondent */}
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-500">Correspondent</p>
                    <p className="font-medium">
                      {document.correspondent || "Not assigned"}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Document Type */}
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-500">Document Type</p>
                    <p className="font-medium">
                      {document.document_type || "Not assigned"}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Created Date */}
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-500">Created</p>
                    <p className="font-medium">
                      {new Date(document.created).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Tags */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Tag className="h-4 w-4 text-zinc-400" />
                    <p className="text-sm text-zinc-500">Tags</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {document.tags.length > 0 ? (
                      document.tags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant={
                            tag.name.startsWith("llm-") ? "secondary" : "outline"
                          }
                        >
                          {tag.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-zinc-400">No tags</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
