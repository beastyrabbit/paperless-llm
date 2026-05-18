"use client";

import { parseDocumentIdString } from "@repo/api-contracts";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, ScrollArea } from "@repo/ui";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FileType,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { documentsApi, type ProcessingLogEntry } from "@/lib/api";
import { useTinyBase } from "@/lib/tinybase";
import { useLogOperations, useProcessingLogs } from "@/lib/tinybase/hooks/useProcessingLogs";

// Step configuration for icons and labels
const stepConfig: Record<string, { icon: typeof FileText; labelKey: string; color: string }> = {
  ocr: { icon: FileText, labelKey: "ocr", color: "text-blue-500" },
  document_agent: { icon: Brain, labelKey: "documentAgent", color: "text-purple-500" },
  review_agent: { icon: MessageSquare, labelKey: "reviewAgent", color: "text-cyan-500" },
  consolidation_agent: { icon: Sparkles, labelKey: "consolidationAgent", color: "text-amber-500" },
  title: { icon: Sparkles, labelKey: "title", color: "text-purple-500" },
  correspondent: { icon: User, labelKey: "correspondent", color: "text-pink-500" },
  document_type: { icon: FileType, labelKey: "documentType", color: "text-indigo-500" },
  tags: { icon: Tag, labelKey: "tags", color: "text-orange-500" },
  custom_fields: { icon: Wrench, labelKey: "customFields", color: "text-teal-500" },
  qdrant_index: { icon: Search, labelKey: "vectorIndex", color: "text-emerald-500" },
  pipeline: { icon: ArrowRight, labelKey: "pipeline", color: "text-emerald-500" },
  lock: { icon: Wrench, labelKey: "lock", color: "text-zinc-500" },
};

function parseLogDate(timestamp: string): Date | null {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLogDate(timestamp: string): string {
  const date = parseLogDate(timestamp);
  if (!date) return timestamp;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatLogTime(timestamp: string): string {
  const date = parseLogDate(timestamp);
  if (!date) return timestamp;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLogDateTime(timestamp: string): string {
  const date = parseLogDate(timestamp);
  if (!date) return timestamp;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isSameLocalDay(first: string, second: string): boolean {
  const firstDate = parseLogDate(first);
  const secondDate = parseLogDate(second);
  if (!firstDate || !secondDate) return first === second;
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function formatLogRange(logs: ProcessingLogEntry[]): string {
  const first = logs[0];
  const last = logs[logs.length - 1];
  if (!first || !last) return "";
  if (first.timestamp === last.timestamp) return formatLogDateTime(last.timestamp);
  if (isSameLocalDay(first.timestamp, last.timestamp)) {
    return `${formatLogDate(first.timestamp)} ${formatLogTime(first.timestamp)} - ${formatLogTime(
      last.timestamp,
    )}`;
  }
  return `${formatLogDateTime(first.timestamp)} - ${formatLogDateTime(last.timestamp)}`;
}

function getFirstLogTime(logs: ProcessingLogEntry[]): number {
  const firstTimestamp = logs[0]?.timestamp;
  if (!firstTimestamp) return Number.MAX_SAFE_INTEGER;
  return parseLogDate(firstTimestamp)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function formatEventCount(
  count: number,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  return t("log.events", { count });
}

interface LogRunGroup {
  id: string;
  runId: string | null;
  logs: ProcessingLogEntry[];
}

function getLogRunId(log: ProcessingLogEntry): string | null {
  const runId = log.data?.runId;
  return typeof runId === "string" && runId.length > 0 ? runId : null;
}

function createRunGroup(runId: string | null, index: number): LogRunGroup {
  return {
    id: runId ?? `unscoped-${index}`,
    runId,
    logs: [],
  };
}

function buildLogRunGroups(logs: ProcessingLogEntry[]): LogRunGroup[] {
  const groups: LogRunGroup[] = [];
  let currentRun: LogRunGroup | null = null;
  let unscopedRun: LogRunGroup | null = null;

  const appendToRun = (run: LogRunGroup, log: ProcessingLogEntry) => {
    run.logs.push(log);
    if (!groups.includes(run)) groups.push(run);
  };

  for (const log of logs) {
    const runId = getLogRunId(log);
    const startsRun =
      (log.eventType === "lock_acquired" || log.eventType === "run_started") && runId !== null;

    if (startsRun && (!currentRun || currentRun.runId !== runId)) {
      currentRun = createRunGroup(runId, groups.length);
      groups.push(currentRun);
    }

    if (currentRun) {
      appendToRun(currentRun, log);
    } else {
      unscopedRun ??= createRunGroup(null, groups.length);
      appendToRun(unscopedRun, log);
    }

    const endsRun =
      currentRun !== null &&
      currentRun.runId === runId &&
      (log.eventType === "lock_released" ||
        log.eventType === "run_failed" ||
        log.eventType === "run_cancelled");
    if (endsRun) currentRun = null;
  }

  return groups.filter((group) => group.logs.length > 0);
}

function getStepsForLogs(logs: ProcessingLogEntry[]): string[] {
  const grouped: Record<string, ProcessingLogEntry[]> = {};
  for (const log of logs) {
    grouped[log.step] ??= [];
    grouped[log.step].push(log);
  }
  return Object.keys(grouped).sort((firstStep, secondStep) => {
    const firstTime = getFirstLogTime(grouped[firstStep] ?? []);
    const secondTime = getFirstLogTime(grouped[secondStep] ?? []);
    return firstTime - secondTime || firstStep.localeCompare(secondStep);
  });
}

function getRunStatus(group: LogRunGroup): "error" | "success" | "cancelled" | "running" {
  if (
    group.logs.some(
      (log) =>
        log.eventType === "error" ||
        log.eventType === "stage_failed" ||
        log.eventType === "run_failed" ||
        log.data?.success === false,
    )
  ) {
    return "error";
  }
  if (group.logs.some((log) => log.eventType === "run_cancelled")) {
    return "cancelled";
  }
  if (
    group.logs.some((log) => log.eventType === "run_completed" || log.eventType === "lock_released")
  ) {
    return "success";
  }
  return "running";
}

function isReviewSignal(log: ProcessingLogEntry): boolean {
  const eventType = log.eventType as string;
  return (
    eventType === "needs_review" ||
    eventType === "pipeline_paused" ||
    log.data?.needsReview === true ||
    log.data?.paused === true
  );
}

function isErrorSignal(log: ProcessingLogEntry): boolean {
  return (
    log.eventType === "error" ||
    log.eventType === "stage_failed" ||
    log.eventType === "run_failed" ||
    log.data?.success === false ||
    log.data?.isError === true
  );
}

function isSuccessSignal(log: ProcessingLogEntry): boolean {
  if (isErrorSignal(log) || isReviewSignal(log)) return false;
  if (log.eventType === "run_completed" || log.eventType === "lock_released") return true;
  if (log.eventType === "state_transition") return true;
  if (log.eventType === "tool_result") return log.data?.isError !== true;
  if (log.eventType !== "result") return false;
  if (log.data?.success !== undefined) return log.data.success !== false;
  if (log.data?.indexed !== undefined) return log.data.indexed !== false;
  return true;
}

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
    if (
      value.includes(",") ||
      value.includes("\n") ||
      value.includes(":") ||
      value.includes("{") ||
      value.includes("[")
    ) {
      return `"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Check if array of primitives
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return `[${value.map((v) => toToonValue(v)).join(",")}]`;
    }
    // Array of objects - check if uniform structure for tabular
    if (value.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) {
      const keys = Object.keys(value[0] as Record<string, unknown>);
      const isUniform = value.every((v) => {
        const vKeys = Object.keys(v as Record<string, unknown>);
        return vKeys.length === keys.length && keys.every((k) => vKeys.includes(k));
      });

      if (isUniform && keys.length > 0) {
        // Tabular TOON format
        const rows = value.map((v) =>
          keys.map((k) => toToonValue((v as Record<string, unknown>)[k])).join(","),
        );
        return `[${value.length}]{${keys.join(",")}}:\n${prefix}  ${rows.join(`\n${prefix}  `)}`;
      }
    }
    // Fall back to array of TOON objects
    return `[\n${value.map((v) => `${prefix}  ${toToonValue(v, indent + 1)}`).join(",\n")}\n${prefix}]`;
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

  let toon = `# Processing Logs (${logs.length} entries)\n`;
  const runs = buildLogRunGroups(logs);
  toon += `# Runs: ${runs.length}\n\n`;

  runs.forEach((run, runIndex) => {
    toon += `## Run ${runIndex + 1}${run.runId ? ` (${run.runId})` : ""} - ${run.logs.length} events\n`;
    toon += `# Range: ${formatLogRange(run.logs)}\n`;

    for (const step of getStepsForLogs(run.logs)) {
      const stepLogs = run.logs.filter((log) => log.step === step);
      toon += `\n### ${step} (${stepLogs.length} events)\n`;

      for (const log of stepLogs) {
        toon += `\n${log.eventType}:\n`;
        toon += `  id:${log.id}\n`;
        toon += `  timestamp:${log.timestamp}\n`;
        toon += `  localTime:${formatLogDateTime(log.timestamp)}\n`;
        if (log.parentId) {
          toon += `  parent:${log.parentId}\n`;
        }
        toon += `  data:${toToonValue(log.data, 1)}\n`;
      }
    }
    toon += "\n";
  });

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
  const t = useTranslations("documentDetail");
  const [expanded, setExpanded] = useState(false);
  const [dataExpanded, setDataExpanded] = useState(false);
  const hasChildren = node.children.length > 0;
  const dataStr = formatLogData(node.data);
  const isLongData = dataStr.length > 200;

  return (
    <div className={cn(depth > 0 && "ml-6 border-l-2 border-muted pl-3")}>
      <div className={cn("rounded-lg border p-2.5", getLogBgClass(node.eventType))}>
        <button
          type="button"
          disabled={!hasChildren}
          aria-expanded={hasChildren ? expanded : undefined}
          className={cn(
            "flex w-full items-start gap-2 text-left disabled:cursor-default disabled:opacity-100",
            hasChildren &&
              "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
          )}
          onClick={() => setExpanded(!expanded)}
        >
          {hasChildren ? (
            <ChevronRight
              className={cn(
                "h-4 w-4 mt-0.5 transition-transform shrink-0",
                expanded && "rotate-90",
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
              <span className="text-xs text-muted-foreground" title={node.timestamp}>
                {formatLogDateTime(node.timestamp)}
              </span>
              {hasChildren && (
                <Badge variant="outline" className="text-xs">
                  {node.children.length}
                </Badge>
              )}
            </div>
          </div>
        </button>
        <div className="mt-1.5 pl-6">
          <pre
            className={cn(
              "text-xs whitespace-pre-wrap font-mono bg-background/50 rounded p-2 overflow-x-auto",
              !dataExpanded && isLongData && "max-h-24 overflow-hidden",
            )}
          >
            {dataStr}
          </pre>
          {isLongData && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-6 text-xs"
              onClick={() => {
                setDataExpanded(!dataExpanded);
              }}
            >
              {dataExpanded ? t("log.showLess") : t("log.showMore")}
            </Button>
          )}
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

export default function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const docId = parseDocumentIdString(resolvedParams.id);
  if (docId === null) notFound();
  const t = useTranslations("documentDetail");

  // TinyBase integration for logs
  const { isSyncing } = useTinyBase();
  const logs = useProcessingLogs(docId);
  const { refresh: refreshLogs, clear: clearLogs } = useLogOperations(docId);

  // Local UI state
  const [docTitle, setDocTitle] = useState<string>("");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
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

  const runGroups = useMemo(() => buildLogRunGroups(logs), [logs]);

  // Auto-expand the latest run when logs arrive
  useEffect(() => {
    if (runGroups.length > 0 && expandedRun === null) {
      const latestRun = runGroups[runGroups.length - 1];
      if (latestRun) {
        setExpandedRun(latestRun.id);
        const firstStep = getStepsForLogs(latestRun.logs)[0];
        if (firstStep) setExpandedStep(`${latestRun.id}:${firstStep}`);
      }
    }
  }, [runGroups, expandedRun]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshLogs();
    setIsRefreshing(false);
  };

  const handleClear = async () => {
    await clearLogs();
    setExpandedRun(null);
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
            <Link href={`/documents/${docId}`} aria-label={t("log.backToDocument")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{t("log.title")}</h1>
            <p className="text-sm text-muted-foreground truncate max-w-md">
              #{docId} - {docTitle || t("log.loading")}
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
            <RefreshCw
              className={cn("h-4 w-4 mr-2", (isRefreshing || isSyncing) && "animate-spin")}
            />
            {t("log.refresh")}
          </Button>
          {logs.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={copyRawLog}>
                {copied ? (
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                ) : copyError ? (
                  <XCircle className="h-4 w-4 mr-2 text-red-500" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {copied ? t("log.copied") : copyError ? t("log.copyFailed") : t("log.copyToon")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleClear}>
                <Trash2 className="h-4 w-4 mr-2" />
                {t("log.clear")}
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
              <p>{t("log.loadingLogs")}</p>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Card className="max-w-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  {t("log.noLogs")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  {t("log.noLogsPrefix")}{" "}
                  <Link
                    href={`/documents/${docId}`}
                    className="text-primary underline hover:no-underline"
                  >
                    {t("log.documentPage")}
                  </Link>{" "}
                  {t("log.noLogsSuffix")}
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-500" />
                    {t("log.reasoning")}
                  </li>
                  <li className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-yellow-500" />
                    {t("log.toolCalls")}
                  </li>
                  <li className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-cyan-500" />
                    {t("log.confirmationSteps")}
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {t("log.results")}
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        ) : (
          <ScrollArea className="h-full" ref={scrollRef}>
            <div className="space-y-2 max-w-4xl mx-auto">
              {runGroups.map((runGroup, runIndex) => {
                const isRunExpanded = expandedRun === runGroup.id;
                const runStatus = getRunStatus(runGroup);
                const runNumber = runGroups
                  .slice(0, runIndex + 1)
                  .filter((group) => group.runId !== null).length;
                return (
                  <div key={runGroup.id} className="border rounded-lg bg-card">
                    <button
                      type="button"
                      aria-expanded={isRunExpanded}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                      onClick={() => setExpandedRun(isRunExpanded ? null : runGroup.id)}
                    >
                      <div className="flex items-center gap-3">
                        <ArrowRight className="h-4 w-4 text-emerald-500" />
                        <span className="font-medium">
                          {runGroup.runId ? t("log.run", { count: runNumber }) : t("log.otherLogs")}
                        </span>
                        {runGroup.runId && (
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {runGroup.runId}
                          </code>
                        )}
                        {!runGroup.runId && (
                          <span className="text-xs text-muted-foreground">
                            {t("log.earlierLogs")}
                          </span>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {formatEventCount(runGroup.logs.length, t)}
                        </Badge>
                        {runGroup.runId && runStatus === "error" && (
                          <Badge variant="destructive" className="text-xs">
                            {t("log.error")}
                          </Badge>
                        )}
                        {runGroup.runId && runStatus === "success" && (
                          <Badge variant="default" className="bg-green-500 text-xs">
                            {t("log.success")}
                          </Badge>
                        )}
                        {runGroup.runId && runStatus === "cancelled" && (
                          <Badge variant="secondary" className="text-xs">
                            {t("log.cancelled")}
                          </Badge>
                        )}
                        {runGroup.runId && runStatus === "running" && (
                          <Badge variant="secondary" className="text-xs">
                            {t("log.running")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatLogRange(runGroup.logs)}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform duration-200",
                            isRunExpanded && "rotate-180",
                          )}
                        />
                      </div>
                    </button>

                    {isRunExpanded && (
                      <div className="border-t bg-muted/10 p-3">
                        <div className="space-y-2">
                          {getStepsForLogs(runGroup.logs).map((step) => {
                            const stepLogs = runGroup.logs.filter((log) => log.step === step);
                            const stepKey = `${runGroup.id}:${step}`;
                            const isExpanded = expandedStep === stepKey;
                            const config = stepConfig[step] || {
                              icon: Sparkles,
                              labelKey: "unknownStep",
                              color: "text-muted-foreground",
                            };
                            const StepIcon = config.icon;

                            const hasError = stepLogs.some(isErrorSignal);
                            const needsReview = stepLogs.some(isReviewSignal);
                            const hasResult = stepLogs.some(
                              (l) =>
                                l.eventType === "result" ||
                                l.eventType === "tool_result" ||
                                l.eventType === "state_transition",
                            );
                            const resultSuccess = !needsReview && stepLogs.some(isSuccessSignal);

                            return (
                              <div
                                key={stepKey}
                                className="overflow-hidden rounded-lg border bg-card"
                              >
                                <button
                                  type="button"
                                  aria-expanded={isExpanded}
                                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
                                  onClick={() => setExpandedStep(isExpanded ? null : stepKey)}
                                >
                                  <div className="flex items-center gap-3">
                                    <StepIcon className={cn("h-4 w-4", config.color)} />
                                    <span className="font-medium">
                                      {config.labelKey === "unknownStep"
                                        ? step
                                        : t(`log.steps.${config.labelKey}`)}
                                    </span>
                                    <Badge variant="outline" className="text-xs">
                                      {formatEventCount(stepLogs.length, t)}
                                    </Badge>
                                    {hasError && (
                                      <Badge variant="destructive" className="text-xs">
                                        {t("log.error")}
                                      </Badge>
                                    )}
                                    {hasResult && !hasError && (
                                      <Badge
                                        variant={resultSuccess ? "default" : "secondary"}
                                        className={cn("text-xs", resultSuccess && "bg-green-500")}
                                      >
                                        {resultSuccess && !needsReview
                                          ? t("log.success")
                                          : t("log.needsReview")}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">
                                      {formatLogRange(stepLogs)}
                                    </span>
                                    <ChevronDown
                                      className={cn(
                                        "h-4 w-4 transition-transform duration-200",
                                        isExpanded && "rotate-180",
                                      )}
                                    />
                                  </div>
                                </button>

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
