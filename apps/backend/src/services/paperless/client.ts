import { Effect, pipe } from "effect";
import type { ConfigService } from "../../config/index.js";
import { NotFoundError, PaperlessError } from "../../errors/index.js";
import { withClientSpan } from "../../observability/tracing.js";
import { fetchWithTimeout } from "../../utils/http.js";
import { type Decoder, decodePaginated } from "./decoders.js";
import type {
  PaginatedResponse,
  PaperlessClientConfig,
  PaperlessConfigProvider,
  PaperlessHttpClient,
} from "./types.js";
import { normalizeConfiguredPaperlessUrl } from "./url.js";

type RequestParams = Record<string, string | number | boolean>;

const readItemId = (item: unknown): number | null => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === "number" && Number.isInteger(id) ? id : null;
};

const paramsKey = (params: RequestParams): string =>
  Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");

const parseNextParams = (
  next: string,
  path: string,
): Effect.Effect<RequestParams, PaperlessError> =>
  Effect.try({
    try: () => {
      const url = new URL(next, "http://paperless-pagination.local");
      if (url.pathname !== `/api${path}`) {
        throw new Error(`next path ${url.pathname} did not match /api${path}`);
      }
      const params: RequestParams = {};
      for (const [key, value] of url.searchParams.entries()) {
        const numeric = Number(value);
        params[key] = Number.isInteger(numeric) && String(numeric) === value ? numeric : value;
      }
      return params;
    },
    catch: (error) =>
      new PaperlessError({
        message: `Invalid Paperless pagination next URL: ${
          error instanceof Error ? error.message : String(error)
        }`,
        cause: error,
        statusCode: 502,
      }),
  });

const failPagination = (message: string) =>
  Effect.fail(
    new PaperlessError({
      message: `Paperless pagination failed closed: ${message}`,
      statusCode: 502,
    }),
  );

export const mapNotFoundToPaperless = <T>(
  effect: Effect.Effect<T, PaperlessError | NotFoundError>,
): Effect.Effect<T, PaperlessError> =>
  pipe(
    effect,
    Effect.mapError((error) =>
      error instanceof NotFoundError
        ? new PaperlessError({ message: error.message, cause: error })
        : error,
    ),
  );

const paperlessApiHeaders = {
  Accept: "application/json; version=10",
  "Content-Type": "application/json",
} as const;

const sanitizeUnexpectedError = (prefix: string, error: unknown) => {
  if (error instanceof PaperlessError || error instanceof NotFoundError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new PaperlessError({ message: `${prefix}: ${message}`, cause: error });
};

export const createPaperlessHttpClient = ({
  configProvider,
}: {
  readonly configProvider: PaperlessConfigProvider;
}): PaperlessHttpClient => {
  const buildUrl = (baseUrl: string, path: string, params?: RequestParams): URL => {
    const url = new URL(`${baseUrl}/api${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  };

  const requireConfig = Effect.gen(function* () {
    const config = yield* configProvider();
    if (!config.url || !config.token) {
      return yield* Effect.fail(new PaperlessError({ message: "Paperless-ngx not configured" }));
    }
    return config;
  });

  const request = <T>(
    method: string,
    path: string,
    decode: Decoder<T>,
    body?: unknown,
    params?: RequestParams,
  ): Effect.Effect<T, PaperlessError | NotFoundError> =>
    pipe(
      Effect.gen(function* () {
        const { url: baseUrl, token, requestTimeoutMs } = yield* requireConfig;
        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchWithTimeout(
              buildUrl(baseUrl, path, params),
              {
                method,
                headers: {
                  Authorization: `Token ${token}`,
                  ...paperlessApiHeaders,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
              },
              requestTimeoutMs,
            );

            if (!response.ok) {
              if (response.status === 404) {
                throw new NotFoundError({ message: `Resource not found at ${path}` });
              }
              throw new PaperlessError({
                message: `Paperless API error: ${response.status} ${response.statusText}`,
                statusCode: response.status,
              });
            }

            if (response.status === 204) {
              return decode(undefined);
            }

            return decode(await response.json());
          },
          catch: (error) => sanitizeUnexpectedError("Request failed", error),
        });
      }),
      withClientSpan("paperless.request", {
        "peer.service": "paperless",
        "http.request.method": method,
        "url.path": path,
        "paperless.api.version": 10,
      }),
    );

  const binaryRequest = (
    method: string,
    path: string,
    params?: RequestParams,
  ): Effect.Effect<Uint8Array, PaperlessError | NotFoundError> =>
    pipe(
      Effect.gen(function* () {
        const { url: baseUrl, token, requestTimeoutMs } = yield* requireConfig;
        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchWithTimeout(
              buildUrl(baseUrl, path, params),
              {
                method,
                headers: {
                  Authorization: `Token ${token}`,
                  Accept: "*/*",
                },
              },
              requestTimeoutMs,
            );

            if (!response.ok) {
              if (response.status === 404) {
                throw new NotFoundError({ message: `Resource not found at ${path}` });
              }
              throw new PaperlessError({
                message: `Paperless API error: ${response.status} ${response.statusText}`,
                statusCode: response.status,
              });
            }

            return new Uint8Array(await response.arrayBuffer());
          },
          catch: (error) => sanitizeUnexpectedError("Binary request failed", error),
        });
      }),
      withClientSpan("paperless.binary_request", {
        "peer.service": "paperless",
        "http.request.method": method,
        "url.path": path,
      }),
    );

  const multipartRequest = <T>(
    method: string,
    path: string,
    formData: FormData,
    decode: Decoder<T>,
  ): Effect.Effect<T, PaperlessError | NotFoundError> =>
    pipe(
      Effect.gen(function* () {
        const { url: baseUrl, token, requestTimeoutMs } = yield* requireConfig;
        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchWithTimeout(
              buildUrl(baseUrl, path),
              {
                method,
                headers: {
                  Authorization: `Token ${token}`,
                  Accept: "application/json; version=10",
                },
                body: formData,
              },
              requestTimeoutMs,
            );

            if (!response.ok) {
              if (response.status === 404) {
                throw new NotFoundError({ message: `Resource not found at ${path}` });
              }
              throw new PaperlessError({
                message: `Paperless API error: ${response.status} ${response.statusText}`,
                statusCode: response.status,
              });
            }

            if (response.status === 204) {
              return decode(undefined);
            }

            return decode(await response.json());
          },
          catch: (error) => sanitizeUnexpectedError("Multipart request failed", error),
        });
      }),
      withClientSpan("paperless.multipart_request", {
        "peer.service": "paperless",
        "http.request.method": method,
        "url.path": path,
        "paperless.api.version": 10,
      }),
    );

  const getAllPages = <T>(
    path: string,
    decodeItem: Decoder<T>,
    params: RequestParams = {},
    options: { pageSize?: number; maxPages?: number } = {},
  ): Effect.Effect<Array<PaginatedResponse<T>>, PaperlessError | NotFoundError> =>
    Effect.gen(function* () {
      const pages: Array<PaginatedResponse<T>> = [];
      const pageSize = options.pageSize ?? 250;
      const maxPages = options.maxPages ?? 10_000;
      const seenPageKeys = new Set<string>();
      const seenNextTargets = new Set<string>();
      const seenItemIds = new Set<number>();
      let expectedCount: number | null = null;
      let currentPage = 1;
      let currentParams: RequestParams = { ...params, page: currentPage, page_size: pageSize };

      while (pages.length < maxPages) {
        const currentKey = paramsKey(currentParams);
        if (seenPageKeys.has(currentKey)) {
          return yield* failPagination(`duplicate or cyclic page ${currentKey}`);
        }
        seenPageKeys.add(currentKey);

        const requestedPage = Number(currentParams.page);
        if (!Number.isInteger(requestedPage) || requestedPage !== currentPage) {
          return yield* failPagination(`missing page ${currentPage}`);
        }
        if (Number(currentParams.page_size) !== pageSize) {
          return yield* failPagination(`page_size changed while reading ${path}`);
        }

        const response = yield* request("GET", path, decodePaginated(decodeItem, path), undefined, {
          ...currentParams,
        });
        pages.push(response);

        if (expectedCount === null) {
          expectedCount = response.count;
        } else if (response.count !== expectedCount) {
          return yield* failPagination(`count changed from ${expectedCount} to ${response.count}`);
        }

        for (const item of response.results) {
          const id = readItemId(item);
          if (id === null) continue;
          if (seenItemIds.has(id)) {
            return yield* failPagination(`duplicate entity/document id ${id}`);
          }
          seenItemIds.add(id);
        }

        const loaded = pages.reduce((count, current) => count + current.results.length, 0);
        if (!response.next) {
          if (loaded !== expectedCount) {
            return yield* failPagination(
              `early end after ${loaded} results but expected ${expectedCount}`,
            );
          }
          return pages;
        }
        if (loaded >= expectedCount) {
          return yield* failPagination(
            `next page present after loading expected count ${expectedCount}`,
          );
        }

        const nextParams = yield* parseNextParams(response.next, path);
        for (const [key, value] of Object.entries(params)) {
          const nextValue = nextParams[key];
          if (nextValue !== undefined && String(nextValue) !== String(value)) {
            return yield* failPagination(
              `query parameter ${key} changed from ${String(value)} to ${String(nextValue)}`,
            );
          }
        }
        const nextKey = paramsKey(nextParams);
        if (seenNextTargets.has(nextKey) || seenPageKeys.has(nextKey)) {
          return yield* failPagination(`duplicate or cyclic next page ${nextKey}`);
        }
        seenNextTargets.add(nextKey);

        const nextPage = Number(nextParams.page);
        if (!Number.isInteger(nextPage) || nextPage !== currentPage + 1) {
          return yield* failPagination(
            `missing page between ${currentPage} and ${String(nextParams.page)}`,
          );
        }

        currentPage = nextPage;
        currentParams = { ...params, ...nextParams, page: nextPage, page_size: pageSize };
      }

      return yield* Effect.fail(
        new PaperlessError({
          message: `Paperless pagination exceeded ${maxPages} pages for ${path}`,
          statusCode: 508,
        }),
      );
    });

  const getAllResults = <T>(
    path: string,
    decodeItem: Decoder<T>,
    params?: RequestParams,
    options?: { pageSize?: number; maxPages?: number },
  ): Effect.Effect<T[], PaperlessError | NotFoundError> =>
    pipe(
      getAllPages<T>(path, decodeItem, params, options),
      Effect.map((pages) => pages.flatMap((page) => page.results)),
    );

  return { request, binaryRequest, multipartRequest, getAllPages, getAllResults };
};

export const createPaperlessConfigProvider = (
  configService: ConfigService,
): PaperlessConfigProvider => {
  const { paperless: configPaperless } = configService.config;
  const requestTimeoutMs = configService.config.http?.requestTimeoutMs ?? 120_000;
  return () =>
    Effect.try({
      try: (): PaperlessClientConfig => ({
        url: normalizeConfiguredPaperlessUrl(configPaperless.url),
        token: configPaperless.token,
        requestTimeoutMs,
      }),
      catch: (error) =>
        new PaperlessError({
          message: `Invalid Paperless URL: ${
            error instanceof Error ? error.message : String(error)
          }`,
          cause: error,
        }),
    });
};
