"use client";

import { useState, useEffect, use, useCallback } from "react";
import {
  ArrowLeft,
  Play,
  FileText,
  User,
  Loader2,
  Sparkles,
  Calendar,
  Tag,
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
  Progress,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@repo/ui";
import Link from "next/link";
import { documentsApi, processingApi, type DocumentDetail } from "@/lib/api";

interface StreamEvent {
  type: string;
  content?: string;
  model?: string;
  step?: string;
  title?: string;
  confirmed?: boolean;
  feedback?: string;
  error?: string;
}

// Helper to determine processing status from tags
function getProcessingStatus(tags: Array<{ id: number; name: string }>): string {
  const tagNames = tags.map((t) => t.name);
  if (tagNames.some((t) => t.includes("processed"))) return "processed";
  if (tagNames.some((t) => t.includes("tags-done"))) return "tags_done";
  if (tagNames.some((t) => t.includes("title-done"))) return "title_done";
  if (tagNames.some((t) => t.includes("document-type-done"))) return "document_type_done";
  if (tagNames.some((t) => t.includes("correspondent-done"))) return "correspondent_done";
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

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [streamOutput, setStreamOutput] = useState<StreamEvent[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Accordion state with session persistence for processing stream
  const [streamAccordionValue, setStreamAccordionValue] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("processing-stream-open");
      return stored === "true" ? ["stream"] : [];
    }
    return [];
  });

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

  // Persist stream accordion state
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(
        "processing-stream-open",
        streamAccordionValue.includes("stream") ? "true" : "false"
      );
    }
  }, [streamAccordionValue]);

  // Start processing with real SSE stream
  const startProcessing = useCallback(() => {
    setProcessing(true);
    setStreamOutput([]);
    setProgress(0);
    // Open the stream accordion when processing starts
    setStreamAccordionValue(["stream"]);

    const eventSource = processingApi.stream(docId);

    let eventCount = 0;
    const estimatedEvents = 20; // Rough estimate for progress

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);
        setStreamOutput((prev) => [...prev, data]);
        eventCount++;
        setProgress(Math.min((eventCount / estimatedEvents) * 100, 95));

        if (data.step) {
          setCurrentStep(data.step);
        }

        // Handle completion
        if (data.type === "pipeline_complete" || data.type === "complete") {
          setProcessing(false);
          setProgress(100);
          eventSource.close();
          // Refresh document to get updated data
          documentsApi.get(docId).then(({ data }) => {
            if (data) setDocument(data);
          });
        }

        // Handle errors
        if (data.type === "error") {
          setProcessing(false);
          eventSource.close();
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setProcessing(false);
      eventSource.close();
      setStreamOutput((prev) => [
        ...prev,
        { type: "error", content: "Connection lost" },
      ]);
    };
  }, [docId]);

  const processingStatus = document ? getProcessingStatus(document.tags) : "unknown";
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
                <p className="text-sm text-zinc-500">{document.title}</p>
                <Badge variant="outline" className="text-xs">
                  {processingStatus.replace(/_/g, " ")}
                </Badge>
              </div>
            </div>
          </div>
          {(() => {
            const nextStep = getNextStep(processingStatus);
            const isProcessed = processingStatus === "processed";
            return (
              <Button
                onClick={startProcessing}
                disabled={processing || isProcessed}
                variant={isProcessed ? "secondary" : "default"}
              >
                {processing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {processing
                  ? "Processing..."
                  : isProcessed
                    ? "Fully Processed"
                    : `Run ${nextStep?.label ?? "Next"} Step`}
              </Button>
            );
          })()}
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

        {/* Processing Stream - Full Width Bottom */}
        <Card>
          <Accordion
            type="multiple"
            value={streamAccordionValue}
            onValueChange={setStreamAccordionValue}
          >
            <AccordionItem value="stream" className="border-0">
              <CardHeader className="py-4">
                <AccordionTrigger className="hover:no-underline [&[data-state=open]>svg]:rotate-180">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-emerald-500" />
                    LLM Processing Stream
                    {processing && (
                      <Badge variant="default" className="ml-2 animate-pulse">
                        Processing
                      </Badge>
                    )}
                  </CardTitle>
                </AccordionTrigger>
              </CardHeader>
              <AccordionContent>
                <CardContent className="pt-0 pb-4">
                  {processing && (
                    <div className="mb-4">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-zinc-500">
                          Processing: {currentStep || "Starting..."}
                        </span>
                        <span className="font-mono">{Math.round(progress)}%</span>
                      </div>
                      <Progress value={progress} />
                    </div>
                  )}

                  <ScrollArea className="h-[250px] rounded-lg border border-zinc-200 bg-zinc-950 p-4 dark:border-zinc-800">
                    <div className="space-y-1 font-mono text-sm text-emerald-400">
                      {streamOutput.length === 0 && !processing && (
                        <p className="text-zinc-500">
                          Click &quot;Process Document&quot; to start...
                        </p>
                      )}
                      {streamOutput.map((event, i) => (
                        <div key={i} className="animate-fade-in">
                          {event.type === "start" && (
                            <p className="text-blue-400">
                              ▶ Starting {event.step} with {event.model}
                            </p>
                          )}
                          {event.type === "step_start" && (
                            <p className="text-blue-400">
                              ▶ Starting step: {event.step}
                            </p>
                          )}
                          {event.type === "pipeline_start" && (
                            <p className="text-blue-400">▶ Pipeline started</p>
                          )}
                          {event.type === "thinking" && (
                            <p className="italic text-zinc-400">
                              💭 {event.content}
                            </p>
                          )}
                          {event.type === "token" && (
                            <span className="text-emerald-300">
                              {event.content}
                            </span>
                          )}
                          {event.type === "analysis_complete" && (
                            <p className="mt-2 text-yellow-400">
                              ✓ Suggested: &quot;{event.title}&quot;
                            </p>
                          )}
                          {event.type === "step_complete" && (
                            <p className="mt-2 font-bold text-emerald-500">
                              ✓ Step {event.step} complete!
                            </p>
                          )}
                          {event.type === "confirmation_start" && (
                            <p className="mt-2 text-purple-400">
                              🔍 Confirming with {event.model}...
                            </p>
                          )}
                          {event.type === "confirmation_result" && (
                            <p
                              className={
                                event.confirmed
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }
                            >
                              {event.confirmed ? "✓" : "✗"} {event.feedback}
                            </p>
                          )}
                          {event.type === "needs_review" && (
                            <p className="text-orange-400">
                              ⚠ Needs manual review
                            </p>
                          )}
                          {event.type === "pipeline_complete" && (
                            <p className="mt-2 font-bold text-emerald-500">
                              ✓ Pipeline complete!
                            </p>
                          )}
                          {event.type === "complete" && (
                            <p className="mt-2 font-bold text-emerald-500">
                              ✓ {event.step} complete!
                            </p>
                          )}
                          {event.type === "error" && (
                            <p className="text-red-400">
                              ✗ Error: {event.content || event.error}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </div>
    </div>
  );
}
