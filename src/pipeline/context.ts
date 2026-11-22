import type { Config, Secrets } from "../config/index.js";
import type { DB } from "../db/db.js";
import type { EntityKind } from "../db/store.js";
import type { Catalog, PaperlessClient } from "../paperless/client.js";
import type { JevClient } from "../providers/jev.js";
import type { LlmClient } from "../providers/llm.js";
import type { MistralClient } from "../providers/mistral.js";

export interface Context {
  db: DB;
  config: Config;
  configHash: string;
  secrets?: Secrets;
  paperless: PaperlessClient;
  mistral: MistralClient;
  jev: JevClient;
  llm: LlmClient;
}
export interface Candidate {
  field: string;
  value: unknown;
  passed: boolean;
  confidence: number;
  evidenceQuote?: string | null;
  newEntity?: { kind: EntityKind; name: string };
  checks?: Record<string, unknown>;
  templateInputs?: string[];
}
export const entitiesOf = (catalog: Catalog, kind: EntityKind) =>
  kind === "correspondent"
    ? catalog.correspondents
    : kind === "document_type"
      ? catalog.document_types
      : catalog.tags;
