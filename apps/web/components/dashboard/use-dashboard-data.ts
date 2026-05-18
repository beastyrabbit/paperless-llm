"use client";

import { useCallback, useEffect, useState } from "react";
import { casesApi, type DocumentCase, type Settings, settingsApi } from "@/lib/api";
import { useGlobalStatus } from "@/lib/global-status";
import { DEFAULT_POLLING_INTERVAL_MS, usePolling } from "@/lib/polling";
import type { ConnectionKey, ConnectionStatus, DashboardData, DashboardErrorKey } from "./types";

const connectionKeys: ConnectionKey[] = ["paperless", "ollama", "qdrant", "mistral"];

const createCheckingConnections = (): ConnectionStatus => ({
  paperless: "checking",
  ollama: "checking",
  qdrant: "checking",
  mistral: "checking",
});

const getQueueErrorKey = (status: number): DashboardErrorKey =>
  status === 0 ? "unableToConnect" : "failedToFetchQueue";

export const useDashboardData = (): DashboardData => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [caseRecords, setCaseRecords] = useState<DocumentCase[]>([]);
  const {
    queueStats: stats,
    autoStatus,
    ollamaStatus,
    errors: globalStatusErrors,
    refresh: refreshGlobalStatus,
  } = useGlobalStatus();
  const [connections, setConnections] = useState<ConnectionStatus>(createCheckingConnections);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<DashboardErrorKey | null>(null);

  const fetchSettings = useCallback(async () => {
    const result = await settingsApi.get();
    if (result.ok) {
      setSettings(result.data);
    }
  }, []);

  const fetchCases = useCallback(async () => {
    const result = await casesApi.list();
    if (result.ok) {
      setCaseRecords(result.data.cases);
    }
  }, []);

  const testConnections = useCallback(async () => {
    await Promise.all(
      connectionKeys.map(async (service) => {
        const result = await settingsApi.testConnection(service);
        const status = result.ok ? result.data.status : "error";
        setConnections((previous) => ({
          ...previous,
          [service]: status === "success" || status === "connected" ? "connected" : "disconnected",
        }));
      }),
    );
  }, []);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setConnections(createCheckingConnections());
    try {
      await Promise.all([fetchSettings(), fetchCases(), testConnections()]);
    } finally {
      setLoading(false);
    }
  }, [fetchSettings, fetchCases, testConnections]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setConnections(createCheckingConnections());
    try {
      await Promise.all([
        fetchSettings(),
        refreshGlobalStatus(),
        fetchCases(),
        testConnections(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [fetchSettings, refreshGlobalStatus, fetchCases, testConnections]);

  useEffect(() => {
    const queueError = globalStatusErrors.queueStats;
    setErrorKey(queueError ? getQueueErrorKey(queueError.status) : null);
  }, [globalStatusErrors.queueStats]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  usePolling(fetchCases, DEFAULT_POLLING_INTERVAL_MS, { fireImmediately: false });

  return {
    settings,
    stats,
    caseRecords,
    autoStatus,
    ollamaStatus,
    connections,
    loading,
    errorKey,
    refresh,
  };
};
