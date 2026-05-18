import { useEffect, useRef } from "react";

export const DEFAULT_POLLING_INTERVAL_MS = 5000;
export const ACTIVE_JOB_POLLING_INTERVAL_MS = 2000;
export const SETTINGS_SYNC_INTERVAL_MS = 30000;

interface UsePollingOptions {
  enabled?: boolean;
  fireImmediately?: boolean;
}

/**
 * Central polling primitive for client-side status refreshes.
 *
 * Keeps one interval per call site, always invokes the latest callback, and
 * pauses while the tab is hidden so background tabs do not multiply load.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  { enabled = true, fireImmediately = true }: UsePollingOptions = {},
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      void callbackRef.current();
    };

    if (fireImmediately) {
      tick();
    }

    const interval = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, fireImmediately, intervalMs]);
}
