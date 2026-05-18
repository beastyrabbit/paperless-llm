"use client";

import { useCallback, useEffect, useState } from "react";
import type { CasesStatusFilter } from "@/components/cases/case-list-model";
import { casesApi, type DocumentCase } from "@/lib/api";

export interface CasesData {
  cases: DocumentCase[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useCasesData = (status: CasesStatusFilter): CasesData => {
  const [cases, setCases] = useState<DocumentCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await casesApi.list(status);
    if (result.error) {
      setError(result.error);
    } else {
      setCases(result.data?.cases ?? []);
    }
    setLoading(false);
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { cases, loading, error, refresh };
};
