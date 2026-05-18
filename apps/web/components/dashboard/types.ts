import type {
  AutoProcessingStatus,
  DocumentCase,
  OllamaStatus,
  QueueStats,
  Settings,
} from "@/lib/api";

export type ConnectionKey = "paperless" | "ollama" | "qdrant" | "mistral";

export type ConnectionState = "connected" | "disconnected" | "checking";

export type ConnectionStatus = Record<ConnectionKey, ConnectionState>;

export type DashboardErrorKey = "failedToFetchQueue" | "unableToConnect";

export interface ServiceInfo {
  name: string;
  key: ConnectionKey;
  url: string;
}

export type CasePhase = DocumentCase["phase"];

export type CasePhaseCounts = Record<CasePhase, number>;

export interface CaseMetrics {
  activeRuns: number;
  needsInput: number;
  done: number;
  failed: number;
  open: number;
  ready: number;
  phaseCounts: CasePhaseCounts;
}

export interface DashboardData {
  settings: Settings | null;
  stats: QueueStats | null;
  caseRecords: DocumentCase[];
  autoStatus: AutoProcessingStatus | null;
  ollamaStatus: OllamaStatus | null;
  connections: ConnectionStatus;
  loading: boolean;
  errorKey: DashboardErrorKey | null;
  refresh: () => Promise<void>;
}
