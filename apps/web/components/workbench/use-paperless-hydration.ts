"use client";

/**
 * Live Paperless hydration for the review / failure queues.
 *
 * The analysis contract carries only document ids; the human-readable title and
 * correspondent live in Paperless. This hook fetches document details on demand
 * and exposes them as a lookup so a row can show "Stadtwerke invoice" instead of
 * a bare "#4821". Hydration is best-effort and non-blocking: a failed or missing
 * document falls back to its id and never takes the queue down with it.
 */
import { useEffect, useRef, useState } from "react";
import { type DocumentDetail, documentsApi } from "@/lib/api";

export interface HydratedDocument {
  readonly title: string;
  readonly correspondent: string | null;
  readonly processingStatus: string | null;
}

export type DocumentLookup = Readonly<Record<number, HydratedDocument>>;

export function usePaperlessHydration(documentIds: readonly number[]): DocumentLookup {
  const [lookup, setLookup] = useState<DocumentLookup>({});
  // Ids already fetched (or in-flight), tracked in a ref so the effect depends
  // only on the id set — reading it here would loop on every setLookup.
  const requested = useRef<Set<number>>(new Set());

  // Stable dependency: distinct ids, sorted, joined. Avoids refetching when the
  // caller passes a new array instance with the same ids.
  const key = [...new Set(documentIds)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const ids = key ? key.split(",").map(Number) : [];
    const missing = ids.filter((id) => !requested.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);

    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        const response = await documentsApi.get(id);
        if (!response.ok) {
          // Allow a later refresh to retry a transient miss.
          requested.current.delete(id);
          return null;
        }
        const detail: DocumentDetail = response.data;
        return [
          id,
          {
            title: detail.title,
            correspondent: detail.correspondent,
            processingStatus: detail.processing_status,
          },
        ] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const resolved = entries.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      if (resolved.length === 0) return;
      setLookup((current) => ({ ...current, ...Object.fromEntries(resolved) }));
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return lookup;
}
