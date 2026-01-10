/**
 * API client utilities for the Paperless Local LLM backend
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const DEFAULT_TIMEOUT = 30000; // 30 seconds

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit & { timeout?: number }
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeout ?? DEFAULT_TIMEOUT
  );

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      return { error: error || `HTTP ${response.status}` };
    }

    // Handle empty responses (e.g., 204 No Content)
    const contentLength = response.headers.get("Content-Length");
    if (response.status === 204 || contentLength === "0") {
      return { data: undefined };
    }

    const text = await response.text();
    if (!text) {
      return { data: undefined };
    }

    const data = JSON.parse(text) as T;
    return { data };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "Request timeout" };
    }
    return { error: String(error) };
  }
}
