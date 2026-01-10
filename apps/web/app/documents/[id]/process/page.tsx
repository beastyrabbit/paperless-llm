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
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Start processing
  const startProcessing = () => {
    setProcessing(true);
    setStarted(true);
    setEvents([]);
    setProgress(0);

    const eventSource = processingApi.stream(docId);
    let eventCount = 0;
    const estimatedEvents = 15;

    eventSource.onmessage = (event) => {
      try {
    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);
        setEvents((prev) => [...prev, data]);
  // Start processing
  const startProcessing = () => {
    setProcessing(true);
    setStarted(true);
    setEvents([]);
    setProgress(0);

    const eventSource = processingApi.stream(docId);
    let eventCount = 0;
    const estimatedEvents = 15;

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);
        setEvents((prev) => [...prev, data]);
        eventCount++;
        setProgress(Math.min((eventCount / estimatedEvents) * 100, 95));

        if (data.type === "pipeline_complete" || data.type === "complete") {
          setProcessing(false);
          setProgress(100);
          eventSource.close();
        }

        if (data.type === "error" || data.type === "step_error") {
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
      setEvents((prev) => [
        ...prev,
        { type: "error", message: "Connection lost" },
      ]);
    };

    // Return cleanup function
    return () => {
      eventSource.close();
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
          {!processing && started && progress === 100 && (
            <Badge variant="outline" className="gap-2 text-green-600 border-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Complete
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
                          {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}
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
