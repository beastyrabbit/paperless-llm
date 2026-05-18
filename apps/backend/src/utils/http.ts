export class HttpTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly url: string,
  ) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "HttpTimeoutError";
  }
}

export const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
  minimum = 1,
): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

export const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const getAbortReason = (signal: AbortSignal): unknown =>
  "reason" in signal ? (signal as AbortSignal & { reason?: unknown }).reason : undefined;

export const fetchWithTimeout = async (
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> => {
  const url = input instanceof Request ? input.url : input.toString();
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let upstreamAbortListener: (() => void) | undefined;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(getAbortReason(upstreamSignal));
    } else {
      upstreamAbortListener = () => controller.abort(getAbortReason(upstreamSignal));
      upstreamSignal.addEventListener("abort", upstreamAbortListener, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    controller.abort(new HttpTimeoutError(timeoutMs, url));
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = getAbortReason(controller.signal);
    if (reason instanceof HttpTimeoutError) {
      throw reason;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (upstreamSignal && upstreamAbortListener) {
      upstreamSignal.removeEventListener("abort", upstreamAbortListener);
    }
  }
};

export const getRetryAfterMs = (response: Response): number | null => {
  const value = response.headers.get("retry-after");
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }

  return null;
};

export const isTransientHttpStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;
