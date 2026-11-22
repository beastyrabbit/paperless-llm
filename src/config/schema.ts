import { z } from "zod";

const url = z.url().refine((value) => {
  const parsed = new URL(value);
  return (
    ["http:", "https:"].includes(parsed.protocol) &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash
  );
}, "Use an HTTP(S) URL without credentials, query, or fragment");
const probability = z.number().min(0).max(1);
const route = z.enum(["cloud", "local"]);
const model = z.object({ baseUrl: url, model: z.string().min(1) }).strict();
export const fieldSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["string", "date", "monetary", "integer", "float", "boolean", "select"]),
    required: z.boolean().default(false),
    semanticCheck: z.boolean().default(false),
    description: z.string().optional(),
    maxLength: z.number().int().positive().optional(),
  })
  .strict();

export const configSchema = z
  .object({
    paperless: z
      .object({
        url,
        externalUrl: url.optional(),
        requestTimeoutMs: z.number().int().positive().default(30_000),
      })
      .strict(),
    ocr: z
      .object({
        enabled: z.boolean().default(false),
        notBefore: z.iso.date(),
        maxPagesPerDay: z.number().int().nonnegative().default(100),
        timeoutMs: z.number().int().positive().max(600_000).default(60_000),
        perPageTimeoutMs: z.number().int().nonnegative().max(600_000).default(15_000),
        mistralApiBaseUrl: url.default("https://api.mistral.ai"),
        mistralModel: z.string().default("mistral-ocr-latest"),
        versionMode: z.enum(["in_place", "derivative"]).default("in_place"),
        allowAutoRetryUncertain: z.boolean().default(false),
      })
      .strict(),
    jev: z
      .object({
        apiBaseUrl: url.default("https://api.typesafe.ai/v1/systemone"),
        model: z.string().default("jev-latest"),
        shortlistLimit: z.number().int().min(1).max(253).default(50),
        thresholds: z
          .object({
            documentType: probability.default(0.9),
            correspondent: probability.default(0.9),
            tag: probability.default(0.9),
            customField: probability.default(0.9),
            semanticCheck: probability.default(0.9),
            consolidation: probability.default(0.98),
          })
          .strict()
          .default({
            documentType: 0.9,
            correspondent: 0.9,
            tag: 0.9,
            customField: 0.9,
            semanticCheck: 0.9,
            consolidation: 0.98,
          }),
      })
      .strict()
      .default({
        apiBaseUrl: "https://api.typesafe.ai/v1/systemone",
        model: "jev-latest",
        shortlistLimit: 50,
        thresholds: {
          documentType: 0.9,
          correspondent: 0.9,
          tag: 0.9,
          customField: 0.9,
          semanticCheck: 0.9,
          consolidation: 0.98,
        },
      }),
    llm: z
      .object({
        defaultProvider: route.default("cloud"),
        cloud: model,
        local: model,
        maxJsonRepairRetries: z.number().int().min(0).max(1).default(1),
      })
      .strict(),
    tags: z
      .object({
        requested: z.string().default("ai:requested"),
        review: z.string().default("ai:review"),
        failed: z.string().default("ai:failed"),
        curated: z.record(z.string(), z.string()).default({}),
      })
      .strict()
      .default({
        requested: "ai:requested",
        review: "ai:review",
        failed: "ai:failed",
        curated: {},
      }),
    stagingMode: z.enum(["dependency_aware", "document"]).default("dependency_aware"),
    documentTypes: z
      .record(
        z.string(),
        z
          .object({
            titleTemplate: z.string().optional(),
            llmRouting: z.enum(["cloud", "local", "none"]).optional(),
            openFields: z.array(fieldSchema).default([]),
            selectFields: z.array(z.string()).default([]),
          })
          .strict(),
      )
      .default({}),
    polling: z
      .object({
        enabled: z.boolean().default(false),
        intervalMs: z.number().int().positive().default(30_000),
        leaseDurationMs: z.number().int().min(1000).default(300_000),
        maxAttempts: z.number().int().positive().default(5),
        batchSize: z.number().int().positive().default(20),
      })
      .strict()
      .default({
        enabled: false,
        intervalMs: 30_000,
        leaseDurationMs: 300_000,
        maxAttempts: 5,
        batchSize: 20,
      }),
    server: z
      .object({
        port: z.number().int().min(1).max(65535).default(3765),
        host: z.string().default("0.0.0.0"),
        allowedHosts: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ port: 3765, host: "0.0.0.0", allowedHosts: [] }),
  })
  .strict()
  .superRefine((config, context) => {
    const services = [config.tags.requested, config.tags.review, config.tags.failed];
    if (new Set(services).size !== 3 || services.some((name) => name in config.tags.curated)) {
      context.addIssue({
        code: "custom",
        message: "Service tags must be distinct and cannot be curated",
      });
    }
  });

export type Config = z.infer<typeof configSchema>;
export type OpenField = z.infer<typeof fieldSchema>;
export type Route = z.infer<typeof route>;
