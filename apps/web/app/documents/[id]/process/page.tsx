"use client";

import { useState, useEffect, use, useRef, useMemo } from "react";
import {
  ArrowLeft,
  Loader2,
  Brain,
  Search,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ChevronRight,
  FileText,
  Tag,
  User,
  FileType,
  RefreshCw,
  Trash2,
  Wrench,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  ScrollArea,
} from "@repo/ui";
import Link from "next/link";
import { documentsApi, type ProcessingLogEntry } from "@/lib/api";
import { cn } from "@repo/ui";
import {
  useProcessingLogs,
  useProcessingLogsByStep,
  useLogOperations,
} from "@/lib/tinybase/hooks/useProcessingLogs";
import { useTinyBase } from "@/lib/tinybase";

// Step configuration for icons and labels
const stepConfig: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  ocr: { icon: FileText, label: "OCR", color: "text-blue-500" },
  title: { icon: Sparkles, label: "Title", color: "text-purple-500" },
  correspondent: { icon: User, label: "Correspondent", color: "text-pink-500" },
  document_type: { icon: FileType, label: "Document Type", color: "text-indigo-500" },
  tags: { icon: Tag, label: "Tags", color: "text-orange-500" },
  custom_fields: { icon: Wrench, label: "Custom Fields", color: "text-teal-500" },
  pipeline: { icon: ArrowRight, label: "Pipeline", color: "text-emerald-500" },
};

// Get icon for log event type
function getLogIcon(eventType: string) {
  switch (eventType) {
    case "context":
      return <FileText className="h-3.5 w-3.5 text-blue-500" />;
    case "prompt":
      return <MessageSquare className="h-3.5 w-3.5 text-cyan-500" />;
    case "response":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "thinking":
      return <Brain className="h-3.5 w-3.5 text-purple-500" />;
    case "tool_call":
      return <Search className="h-3.5 w-3.5 text-yellow-500" />;
    case "tool_result":
      return <Sparkles className="h-3.5 w-3.5 text-amber-500" />;
    case "confirming":
      return <MessageSquare className="h-3.5 w-3.5 text-cyan-500" />;
    case "retry":
      return <RefreshCw className="h-3.5 w-3.5 text-orange-500" />;
    case "result":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "state_transition":
      return <ArrowRight className="h-3.5 w-3.5 text-emerald-500" />;
    default:
      return <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// Get background color for log event type
function getLogBgClass(eventType: string): string {
  switch (eventType) {
    case "thinking":
      return "bg-purple-500/5 border-purple-500/20";
    case "prompt":
      return "bg-cyan-500/5 border-cyan-500/20";
    case "response":
    case "result":
      return "bg-green-500/5 border-green-500/20";
    case "tool_call":
    case "tool_result":
      return "bg-yellow-500/5 border-yellow-500/20";
    case "confirming":
      return "bg-cyan-500/5 border-cyan-500/20";
    case "error":
      return "bg-red-500/5 border-red-500/20";
    case "state_transition":
      return "bg-emerald-500/5 border-emerald-500/20";
    default:
      return "bg-muted/30 border-border";
  }
}

// Format log data for display
function formatLogData(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

// Convert value to TOON format
function toToonValue(value: unknown, indent = 0): string {
  const prefix = "  ".repeat(indent);

  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Escape special characters and wrap in quotes if contains special chars
    if (value.includes(",") || value.includes("\n") || value.includes(":") || value.includes("{") || value.includes("[")) {
      return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Check if array of primitives
    if (value.every(v => typeof v !== "object" || v === null)) {
      return `[${value.map(v => toToonValue(v)).join(",")}]`;
    }
    // Array of objects - check if uniform structure for tabular
    if (value.every(v => typeof v === "object" && v !== null && !Array.isArray(v))) {
      const keys = Object.keys(value[0] as Record<string, unknown>);
      const isUniform = value.every(v => {
        const vKeys = Object.keys(v as Record<string, unknown>);
        return vKeys.length === keys.length && keys.every(k => vKeys.includes(k));
      });

      if (isUniform && keys.length > 0) {
        // Tabular TOON format
        const rows = value.map(v =>
          keys.map(k => toToonValue((v as Record<string, unknown>)[k])).join(",")
        );
        return `[${value.length}]{${keys.join(",")}}:\n${prefix}  ${rows.join(`\n${prefix}  `)}`;
      }
    }
    // Fall back to array of TOON objects
    return `[\n${value.map(v => `${prefix}  ${toToonValue(v, indent + 1)}`).join(",\n")}\n${prefix}]`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, v]) => `${prefix}  ${k}:${toToonValue(v, indent + 1)}`).join("\n")}\n${prefix}}`;
  }

  return String(value);
}

// Convert logs to TOON format
function logsToToon(logs: ProcessingLogEntry[]): string {
  if (logs.length === 0) return "logs[0]{}:";

  // Group by step for better organization
  const steps = [...new Set(logs.map(l => l.step))];

  let toon = `# Processing Logs (${logs.length} entries)\n`;
  toon += `# Steps: ${steps.join(", ")}\n\n`;

  for (const step of steps) {
    const stepLogs = logs.filter(l => l.step === step);
    toon += `## ${step} (${stepLogs.length} events)\n`;

    for (const log of stepLogs) {
      toon += `\n${log.eventType}:\n`;
      toon += `  id:${log.id}\n`;
      toon += `  time:${new Date(log.timestamp).toLocaleTimeString()}\n`;
      if (log.parentId) {
        toon += `  parent:${log.parentId}\n`;
      }
      toon += `  data:${toToonValue(log.data, 1)}\n`;
    }
    toon += "\n";
  }

  return toon;
}

// Log tree node interface
interface LogNode extends ProcessingLogEntry {
  children: LogNode[];
}

// Build tree from flat logs based on parentId relationships
function buildLogTree(logs: ProcessingLogEntry[]): LogNode[] {
  const nodeMap = new Map<string, LogNode>();
  const roots: LogNode[] = [];

  // Create nodes with empty children arrays
  for (const log of logs) {
    nodeMap.set(log.id, { ...log, children: [] });
  }

  // Build parent-child relationships
  for (const log of logs) {
    const node = nodeMap.get(log.id);
    if (!node) continue;
    if (log.parentId) {
      const parent = nodeMap.get(log.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// Recursive tree node component
function LogTreeNode({ node, depth = 0 }: { node: LogNode; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [dataExpanded, setDataExpanded] = useState(false);
  const hasChildren = node.children.length > 0;
  const dataStr = formatLogData(node.data);
  const isLongData = dataStr.length > 200;

  return (
    <div className={cn(depth > 0 && "ml-6 border-l-2 border-muted pl-3")}>
      <div
        className={cn(
          "rounded-lg border p-2.5",
          getLogBgClass(node.eventType),
          hasChildren && "cursor-pointer"
        )}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <div className="flex items-start gap-2">
          {hasChildren ? (
            <ChevronRight
              className={cn(
                "h-4 w-4 mt-0.5 transition-transform shrink-0",
                expanded && "rotate-90"
              )}
            />
          ) : (
            <div className="w-4 shrink-0" />
          )}
          <div className="mt-0.5">{getLogIcon(node.eventType)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-xs uppercase tracking-wide">
                {node.eventType.replace("_", " ")}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(node.timestamp).toLocaleTimeString()}
              </span>
              {hasChildren && (
                <Badge variant="outline" className="text-xs">
                  {node.children.length}
                </Badge>
              )}
            </div>
            <div className="mt-1.5">
              <pre
                className={cn(
                  "text-xs whitespace-pre-wrap font-mono bg-background/50 rounded p-2 overflow-x-auto",
                  !dataExpanded && isLongData && "max-h-24 overflow-hidden"
                )}
                onClick={(e) => e.stopPropagation()}
              >
                {dataStr}
              </pre>
              {isLongData && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-6 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDataExpanded(!dataExpanded);
                  }}
                >
                  {dataExpanded ? "Show less" : "Show more"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Render children when expanded */}
      {expanded && hasChildren && (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <LogTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProcessingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const docId = parseInt(resolvedParams.id);

  // TinyBase integration for logs
  const { isSyncing } = useTinyBase();
  const logs = useProcessingLogs(docId);
  const logsByStep = useProcessingLogsByStep(docId);
  const { refresh: refreshLogs, clear: clearLogs } = useLogOperations(docId);

  // Local UI state
  const [docTitle, setDocTitle] = useState<string>("");
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch document title on mount
  useEffect(() => {
    documentsApi.get(docId).then(({ data }) => {
      if (data) setDocTitle(data.title);
    });
  }, [docId]);

  // Auto-expand first step when logs arrive
  useEffect(() => {
    if (logs.length > 0 && expandedStep === null) {
      setExpandedStep(logs[0].step);
    }
  }, [logs, expandedStep]);

  // Get steps in order
  const steps = useMemo(() => {
    const orderedSteps = ["ocr", "title", "correspondent", "document_type", "tags", "custom_fields", "pipeline"];
    return orderedSteps.filter(step => logsByStep[step]?.length > 0);
  }, [logsByStep]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshLogs();
    setIsRefreshing(false);
  };

  const handleClear = async () => {
    await clearLogs();
    setExpandedStep(null);
  };

  const copyRawLog = async () => {
    try {
      const toonLog = logsToToon(logs);
      await navigator.clipboard.writeText(toonLog);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy logs:", err);
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  };

  const isLoading = isSyncing && logs.length === 0;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/documents/${docId}`}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Processing Logs</h1>
            <p className="text-sm text-muted-foreground truncate max-w-md">
              #{docId} - {docTitle || "Loading..."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || isSyncing}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", (isRefreshing || isSyncing) && "animate-spin")} />
            Refresh
          </Button>
          {logs.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={copyRawLog}
              >
                {copied ? (
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                ) : copyError ? (
                  <XCircle className="h-4 w-4 mr-2 text-red-500" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {copied ? "Copied!" : copyError ? "Failed" : "Copy TOON"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 overflow-hidden p-6">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
              <p>Loading processing logs...</p>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  No Processing Logs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  This document hasn&apos;t been processed yet, or logs have been cleared.
                  Go to the{" "}
                  <Link href={`/documents/${docId}`} className="text-primary underline hover:no-underline">
                    document page
                  </Link>{" "}
                  to start processing.
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-500" />
                    LLM reasoning and thoughts
                  </li>
                  <li className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-yellow-500" />
                    Tool calls and results
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
          <ScrollArea className="h-full" ref={scrollRef}>
            <div className="space-y-2 max-w-4xl mx-auto">
              {/* Accordion for each step */}
              {steps.map((step) => {
                const stepLogs = logsByStep[step] || [];
                const isExpanded = expandedStep === step;
                const latestLog = stepLogs[stepLogs.length - 1];
                const config = stepConfig[step] || { icon: Sparkles, label: step, color: "text-muted-foreground" };
                const StepIcon = config.icon;

                // Check if step had errors
                const hasError = stepLogs.some(l => l.eventType === "error");
                const hasResult = stepLogs.some(l => l.eventType === "result");
                const resultLog = stepLogs.find(l => l.eventType === "result");
                const resultSuccess = Boolean(resultLog?.data?.success);

                return (
                  <div key={step} className="border rounded-lg overflow-hidden bg-card">
                    {/* Accordion Header */}
                    <button
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedStep(isExpanded ? null : step)}
                    >
                      <div className="flex items-center gap-3">
                        <StepIcon className={cn("h-4 w-4", config.color)} />
                        <span className="font-medium">{config.label}</span>
                        <Badge variant="outline" className="text-xs">
                          {stepLogs.length} events
                        </Badge>
                        {hasError && (
                          <Badge variant="destructive" className="text-xs">
                            Error
                          </Badge>
                        )}
                        {hasResult && !hasError && (
                          <Badge
                            variant={resultSuccess ? "default" : "secondary"}
                            className={cn("text-xs", resultSuccess && "bg-green-500")}
                          >
                            {resultSuccess ? "Success" : "Needs Review"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {latestLog && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(latestLog.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            isExpanded && "rotate-180"
                          )}
                        />
                      </div>
                    </button>

                    {/* Accordion Content */}
                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-2 bg-muted/20">
                        {buildLogTree(stepLogs).map((node) => (
                          <LogTreeNode key={node.id} node={node} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
