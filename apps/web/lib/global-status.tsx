"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  type AutoProcessingStatus,
  documentsApi,
  type OllamaStatus,
  processingApi,
  type QueueStats,
  settingsApi,
} from "@/lib/api";
import { DEFAULT_POLLING_INTERVAL_MS, usePolling } from "@/lib/polling";

type ResourceKey = "queueStats" | "autoStatus" | "ollamaStatus";

interface GlobalStatusError {
  status: number;
}

type GlobalStatusErrors = Partial<Record<ResourceKey, GlobalStatusError>>;

interface GlobalStatusContextValue {
  queueStats: QueueStats | null;
  autoStatus: AutoProcessingStatus | null;
  ollamaStatus: OllamaStatus | null;
  errors: GlobalStatusErrors;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

const GlobalStatusContext = createContext<GlobalStatusContextValue | null>(null);

export function GlobalStatusProvider({ children }: { children: ReactNode }) {
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [autoStatus, setAutoStatus] = useState<AutoProcessingStatus | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [errors, setErrors] = useState<GlobalStatusErrors>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRefresh = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRefresh.current) {
      return inFlightRefresh.current;
    }

    const refreshPromise = (async () => {
      setIsRefreshing(true);
      const [queueResult, autoResult, ollamaResult] = await Promise.all([
        documentsApi.getQueue(),
        processingApi.getAutoStatus(),
        settingsApi.getOllamaStatus(),
      ]);

      if (queueResult.ok) {
        setQueueStats(queueResult.data);
      }
      if (autoResult.ok) {
        setAutoStatus(autoResult.data);
      }
      if (ollamaResult.ok) {
        setOllamaStatus(ollamaResult.data);
      }

      setErrors((previous) => {
        const next = { ...previous };

        if (queueResult.ok) {
          delete next.queueStats;
        } else {
          next.queueStats = { status: queueResult.status };
        }

        if (autoResult.ok) {
          delete next.autoStatus;
        } else {
          next.autoStatus = { status: autoResult.status };
        }

        if (ollamaResult.ok) {
          delete next.ollamaStatus;
        } else {
          next.ollamaStatus = { status: ollamaResult.status };
        }

        return next;
      });
    })()
      .catch(() => {
        setErrors((previous) => ({
          ...previous,
          queueStats: previous.queueStats ?? { status: 0 },
          autoStatus: previous.autoStatus ?? { status: 0 },
          ollamaStatus: previous.ollamaStatus ?? { status: 0 },
        }));
      })
      .finally(() => {
        inFlightRefresh.current = null;
        setIsRefreshing(false);
      });

    inFlightRefresh.current = refreshPromise;
    return refreshPromise;
  }, []);

  usePolling(refresh, DEFAULT_POLLING_INTERVAL_MS);

  return (
    <GlobalStatusContext.Provider
      value={{ queueStats, autoStatus, ollamaStatus, errors, isRefreshing, refresh }}
    >
      {children}
    </GlobalStatusContext.Provider>
  );
}

export function useGlobalStatus() {
  const context = useContext(GlobalStatusContext);
  if (!context) {
    throw new Error("useGlobalStatus must be used within GlobalStatusProvider");
  }
  return context;
}
