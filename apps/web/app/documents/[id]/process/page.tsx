"use client";

import { useState, useEffect, use, useRef } from "react";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Brain,
  Search,
  MessageSquare,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ScrollArea,
  Progress,
} from "@repo/ui";
import Link from "next/link";
import { processingApi, documentsApi } from "@/lib/api";

interface StreamEvent {
  type: string;
  docId?: number;
  step?: string;
  data?: unknown;
  message?: string;
  reason?: string;
  timestamp?: string;
}

// Format event data for display - show full details
function formatEventData(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // For step results, show full JSON for transparency
    if (obj.success !== undefined || obj.value !== undefined || obj.reasoning !== undefined) {
      try {
        return JSON.stringify(obj, null, 2);
      } catch {
        return String(data);
      }
    }

    // Extract specific fields for simple events
    if (obj.thought) return String(obj.thought);
    if (obj.progress) return String(obj.progress);
    if (obj.suggestion) return String(obj.suggestion);

    // Default: show full JSON
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(data);
    }
  }
  return String(data);
}

// Get icon for event type
function getEventIcon(type: string) {
  switch (type) {
    case "pipeline_start":
      return <Play className="h-4 w-4 text-blue-500" />;
    case "step_start":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "analyzing":
      return <Search className="h-4 w-4 text-yellow-500" />;
    case "thinking":
      return <Brain className="h-4 w-4 text-purple-500" />;
    case "confirming":
      return <MessageSquare className="h-4 w-4 text-cyan-500" />;
    case "step_complete":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "pipeline_complete":
      return <Sparkles className="h-4 w-4 text-green-500" />;
    case "step_error":
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "needs_review":
      return <AlertCircle className="h-4 w-4 text-orange-500" />;
    default:
      return <Sparkles className="h-4 w-4 text-muted-foreground" />;
  }
}

// Get label for event type
function getEventLabel(event: StreamEvent): string {
  switch (event.type) {
    case "pipeline_start":
      return "Pipeline Started";
    case "step_start":
      return `Starting: ${event.step}`;
    case "analyzing":
      return `Analyzing (${event.step})`;
    case "thinking":
      return `LLM Reasoning (${event.step})`;
    case "confirming":
      return `Confirming (${event.step})`;
    case "step_complete":
      return `Completed: ${event.step}`;
    case "pipeline_complete":
      return event.message || "Pipeline Complete";
    case "step_error":
      return `Error in ${event.step}: ${event.message}`;
    case "error":
      return `Error: ${event.message}`;
    case "needs_review":
      return `Needs Review: ${event.step}`;
    default:
      return event.type;
  }
}

// Get background color for event type
function getEventBgClass(type: string): string {
  switch (type) {
    case "thinking":
      return "bg-purple-500/10 border-purple-500/20";
    case "analyzing":
      return "bg-yellow-500/10 border-yellow-500/20";
    case "confirming":
      return "bg-cyan-500/10 border-cyan-500/20";
    case "step_complete":
    case "pipeline_complete":
      return "bg-green-500/10 border-green-500/20";
    case "step_error":
    case "error":
      return "bg-red-500/10 border-red-500/20";
    case "needs_review":
      return "bg-orange-500/10 border-orange-500/20";
    default:
      return "bg-muted/50 border-border";
  }
}

export default function ProcessingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const docId = parseInt(resolvedParams.id);

  const [docTitle, setDocTitle] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [started, setStarted] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [hadErrors, setHadErrors] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch document title
  useEffect(() => {
    documentsApi.get(docId).then(({ data }) => {
      if (data) setDocTitle(data.title);
    });
  }, [docId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  // Start processing
  const startProcessing = () => {
    // Close any existing connection and clear handlers to prevent race condition
    if (eventSourceRef.current) {
      const oldEventSource = eventSourceRef.current;
      oldEventSource.onmessage = null;
      oldEventSource.onerror = null;
      oldEventSource.close();
      eventSourceRef.current = null;
    }

    setProcessing(true);
    setStarted(true);
    setEvents([]);
    setProgress(0);
    setHadErrors(false);

    const eventSource = processingApi.stream(docId);
    eventSourceRef.current = eventSource;
    let eventCount = 0;
    const estimatedEvents = 15;

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);
        // Warn if timestamp is missing (server should always provide it)
        if (!data.timestamp) {
          console.warn("[SSE] Event missing timestamp:", data);
          data.timestamp = new Date().toISOString();
        }
        setEvents((prev) => [...prev, data]);
        eventCount++;
        setProgress(Math.min((eventCount / estimatedEvents) * 100, 95));

        if (data.type === "pipeline_complete" || data.type === "complete") {
          setProcessing(false);
          // Check for errors in accumulated events and set final progress
          setEvents((prevEvents) => {
            const hasErrors = prevEvents.some(e => e.type === "error" || e.type === "step_error");
            setHadErrors(hasErrors);
            // On success, complete to 100%. On error, keep progress where it stopped (don't fake a percentage)
            if (!hasErrors) {
              setProgress(100);
            }
            return prevEvents;
          });
          eventSource.close();
          eventSourceRef.current = null;
        }

        if (data.type === "error" || data.type === "step_error") {
          setHadErrors(true);
          setProcessing(false);
          eventSource.close();
          eventSourceRef.current = null;
        }
      } catch (parseError) {
        console.error("Failed to parse SSE event:", parseError, "Raw data:", event.data);
        setEvents((prev) => [
          ...prev,
          { type: "error", message: `Failed to parse event: ${parseError}`, timestamp: new Date().toISOString() },
        ]);
      }
    };

    eventSource.onerror = (error) => {
      console.error("SSE connection error:", error);
      setProcessing(false);
      setHadErrors(true);
      eventSource.close();
      eventSourceRef.current = null;
      setEvents((prev) => [
        ...prev,
        { type: "error", message: "Connection lost. Check console for details.", timestamp: new Date().toISOString() },
      ]);
    };
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b px-6 py-4 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/documents/${docId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold">LLM Processing</h1>
            <p className="text-sm text-muted-foreground truncate max-w-md">
              {docTitle || `Document ${docId}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {!processing && started && progress === 100 && !hadErrors && (
            <Badge variant="outline" className="gap-2 text-green-600 border-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Complete
            </Badge>
          )}
          {!processing && started && hadErrors && (
            <Badge variant="outline" className="gap-2 text-red-600 border-red-600">
              <XCircle className="h-3 w-3" />
              Completed with Errors
            </Badge>
          )}
          <Button
            onClick={startProcessing}
            disabled={processing}
            size="sm"
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {started ? "Run Next Step" : "Start Processing"}
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Progress bar */}
      {started && (
        <div className="px-6 py-2 border-b">
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden p-6">
        {!started ? (
          <div className="h-full flex items-center justify-center">
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Ready to Process
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Click the button above to start LLM processing. You&apos;ll see
                  detailed logs of the AI analysis including:
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-500" />
                    LLM reasoning and thoughts
                  </li>
                  <li className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-yellow-500" />
                    Analysis progress
                  </li>
                  <li className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-cyan-500" />
                    Confirmation steps
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    Results and outcomes
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="h-full flex flex-col">
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-base">Processing Log</CardTitle>
            </CardHeader>
            <ScrollArea className="flex-1" ref={scrollRef}>
              <div className="p-4 space-y-3">
                {events.map((event, idx) => {
                  const eventData = formatEventData(event.data);
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 ${getEventBgClass(event.type)}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{getEventIcon(event.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {getEventLabel(event)}
                          </div>
                          {eventData && (
                            <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap font-mono bg-background/50 rounded p-2 overflow-x-auto">
                              {eventData}
                            </pre>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {event.timestamp
                            ? new Date(event.timestamp).toLocaleTimeString()
                            : new Date().toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {events.length === 0 && processing && (
                  <div className="text-center text-muted-foreground py-8">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    Waiting for events...
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        )}
      </div>
    </div>
  );
}
