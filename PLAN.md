# Paperless Local LLM: Full-Stack Rewrite Plan

## Executive Summary

Complete rewrite from Python FastAPI + Next.js/Bun to unified TypeScript stack:
- **Backend**: Node.js + Effect-TS (full adoption) + TinyBase (database + sync)
- **Frontend**: Next.js + TinyBase (state) + pnpm/Turborepo
- **Testing**: Vitest (unit/integration) + Playwright (E2E)
- **Branch**: `feature/full-stack-rewrite` (worktree)

**Total estimated functions to migrate: ~250-300**
**Total tests to write: ~475+**

---

## Phase 0: Foundation Setup

### 0.1 Create Git Worktree
```bash
cd /mnt/storage/workspace/projects/paperless_local_llm
git worktree add ../paperless-rewrite feature/full-stack-rewrite
cd ../paperless-rewrite
```

### 0.2 Switch Package Manager: Bun → pnpm

**Files to modify:**

1. **Delete**: `bun.lock`

2. **Update `package.json`**:
```json
{
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "precommit": "turbo run precommit"
  }
}
```

3. **Create `pnpm-workspace.yaml`**:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

4. **Run**: `pnpm install`

### 0.3 Update Turborepo Pre-commit

**Update `turbo.json`** - add precommit task:
```json
{
  "tasks": {
    "precommit": {
      "dependsOn": ["lint", "typecheck", "test:unit"],
      "outputs": []
    },
    "test:unit": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "outputs": []
    }
  }
}
```

**Update `.pre-commit-config.yaml`**:
```yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2
    hooks:
      - id: gitleaks

  - repo: local
    hooks:
      - id: turbo-precommit
        name: Turbo Pre-commit Checks
        entry: pnpm turbo run precommit --filter='...[HEAD^]'
        language: system
        pass_filenames: false
        always_run: true
```

### 0.4 Copy Essential Files to Worktree
After worktree creation, ensure these are present:
- `.pre-commit-config.yaml`
- `turbo.json`
- `config.example.yaml`
- All `apps/` and `packages/` directories

---

## Phase 1: Frontend Restructuring (BEFORE backend migration)

### 1.1 Settings Page Split (3,400 lines → 10+ components)

**Source**: `apps/web/app/settings/page.tsx`
**Target Directory**: `apps/web/components/settings/`

| Component | Est. Lines | Description |
|-----------|------------|-------------|
| `ConnectionsTab.tsx` | ~400 | Service connection tests (Paperless, Ollama, Qdrant, Mistral) |
| `ProcessingTab.tsx` | ~350 | Auto-processing toggle, interval, confirmation settings |
| `PipelineTab.tsx` | ~300 | Pipeline step enables (OCR, title, correspondent, etc.) |
| `CustomFieldsTab.tsx` | ~400 | Custom fields selection and configuration |
| `AiTagsTab.tsx` | ~350 | AI tags enable/disable management |
| `AiDocTypesTab.tsx` | ~300 | AI document types configuration |
| `WorkflowTagsTab.tsx` | ~350 | Workflow tags status check and creation |
| `LanguageTab.tsx` | ~400 | Language and translation settings |
| `AdvancedTab.tsx` | ~250 | Debug settings, log levels |
| `MaintenanceTab.tsx` | ~500 | Bootstrap analysis, bulk OCR, scheduled jobs |
| `hooks/useSettings.ts` | ~200 | Settings state management hook |
| `hooks/useConnectionTests.ts` | ~150 | Connection test logic |
| `SettingsLayout.tsx` | ~100 | Tab navigation wrapper |

**Final `page.tsx`**: ~150 lines (just composition)

### 1.2 Pending Page Split (1,746 lines → 6+ components)

**Source**: `apps/web/app/pending/page.tsx`
**Target Directory**: `apps/web/components/pending/`

| Component | Est. Lines | Description |
|-----------|------------|-------------|
| `PendingItemCard.tsx` | ~200 | Single pending item display with actions |
| `PendingBulkActions.tsx` | ~150 | Bulk selection toolbar |
| `SchemaCleanupView.tsx` | ~250 | Merge/delete schema cleanup UI |
| `BlockedItemsView.tsx` | ~200 | Blocked suggestions management |
| `SimilarSuggestionsModal.tsx` | ~200 | Similar items merge modal |
| `RejectModal.tsx` | ~150 | Single/bulk rejection modal with categories |
| `hooks/usePendingItems.ts` | ~150 | Pending items state and fetching |
| `hooks/useBulkOperations.ts` | ~100 | Bulk operation logic |

**Final `page.tsx`**: ~200 lines

### 1.3 API Client Split (779 lines → 11 files)

**Source**: `apps/web/lib/api.ts`
**Target Directory**: `apps/web/lib/api/`

| File | Lines | APIs |
|------|-------|------|
| `client.ts` | ~50 | Base `fetchApi` helper, error handling |
| `types.ts` | ~200 | All TypeScript interfaces |
| `settings.ts` | ~80 | `settingsApi` (4 methods) |
| `documents.ts` | ~60 | `documentsApi` (4 methods) |
| `processing.ts` | ~50 | `processingApi` (3 methods) |
| `prompts.ts` | ~60 | `promptsApi` (5 methods) |
| `pending.ts` | ~100 | `pendingApi` (8 methods) |
| `metadata.ts` | ~80 | `metadataApi` (6 methods) |
| `schema.ts` | ~50 | `schemaApi` (3 methods) |
| `jobs.ts` | ~100 | `jobsApi` (10 methods) |
| `translation.ts` | ~50 | `translationApi` (4 methods) |
| `index.ts` | ~30 | Re-export barrel |

### 1.4 Other Page Splits

**Document Detail** (`apps/web/app/documents/[id]/page.tsx` - 485 lines):
- `components/documents/ProcessingStream.tsx` (~150 lines)
- `components/documents/DocumentMetadata.tsx` (~100 lines)
- `components/documents/DocumentContent.tsx` (~80 lines)

**Dashboard** (`apps/web/app/page.tsx` - 459 lines):
- `components/dashboard/QueueStats.tsx` (~120 lines)
- `components/dashboard/ProcessingStatus.tsx` (~100 lines)
- `components/dashboard/ServiceConnections.tsx` (~100 lines)

**Prompts** (`apps/web/app/prompts/page.tsx` - 487 lines):
- `components/prompts/PromptEditor.tsx` (~200 lines)
- `components/prompts/PromptPreview.tsx` (~100 lines)
- `components/prompts/PromptsList.tsx` (~100 lines)

### 1.5 Install TinyBase for Frontend State

```bash
pnpm add tinybase -w --filter @repo/web
```

**Create `apps/web/lib/store/index.ts`**:
```typescript
import { createStore, createCheckpoints, createQueries } from 'tinybase';
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client';

export const store = createStore()
  .setTablesSchema({
    settings: {
      key: { type: 'string' },
      value: { type: 'string' },
    },
    pendingItems: {
      id: { type: 'string' },
      docId: { type: 'number' },
      type: { type: 'string' },
      suggestion: { type: 'string' },
      reasoning: { type: 'string' },
      alternatives: { type: 'string' }, // JSON
      attempts: { type: 'number' },
      createdAt: { type: 'string' },
    },
    documents: {
      id: { type: 'number' },
      title: { type: 'string' },
      correspondent: { type: 'string' },
      tags: { type: 'string' }, // JSON
      processingStatus: { type: 'string' },
    },
    jobStatus: {
      name: { type: 'string' },
      status: { type: 'string' },
      lastRun: { type: 'string' },
      progress: { type: 'string' }, // JSON
    },
  });

export const checkpoints = createCheckpoints(store);
export const queries = createQueries(store);

// Sync with backend
export const initSync = async (wsUrl: string) => {
  const synchronizer = await createWsSynchronizer(store, new WebSocket(wsUrl));
  await synchronizer.startSync();
  return synchronizer;
};
```

**Create `apps/web/lib/store/hooks.ts`**:
```typescript
import { useRow, useTable, useCell, useCreateStore } from 'tinybase/ui-react';
import { store } from './index';

export const usePendingItems = () => useTable('pendingItems', store);
export const useSettings = () => useTable('settings', store);
export const useJobStatus = (name: string) => useRow('jobStatus', name, store);
```

### 1.6 Playwright E2E Setup

```bash
pnpm add -D @playwright/test playwright -w --filter @repo/web
pnpm exec playwright install
```

**Create `apps/web/playwright.config.ts`**:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

**E2E Test Files to Create**:
| File | Tests | Coverage |
|------|-------|----------|
| `e2e/dashboard.spec.ts` | 10 | Queue stats, connections, navigation |
| `e2e/documents.spec.ts` | 12 | List, search, filter, detail view |
| `e2e/settings.spec.ts` | 15 | All tabs, save/load, connection tests |
| `e2e/pending.spec.ts` | 15 | Approve, reject, bulk ops, cleanup |
| `e2e/prompts.spec.ts` | 8 | Edit, preview, language switch |

---

## Phase 2: Python Backend Tests

### 2.1 Test Directory Structure
```
apps/backend/tests/
├── conftest.py                      # Fixtures: mock Paperless, Ollama, etc.
├── test_routers/
│   ├── test_settings.py             # 15 tests
│   ├── test_documents.py            # 10 tests
│   ├── test_processing.py           # 8 tests
│   ├── test_prompts.py              # 12 tests
│   ├── test_pending.py              # 25 tests
│   ├── test_metadata.py             # 15 tests
│   ├── test_translation.py          # 8 tests
│   ├── test_schema.py               # 6 tests
│   └── test_jobs.py                 # 20 tests
├── test_services/
│   ├── test_paperless.py            # 30 tests
│   ├── test_qdrant.py               # 15 tests
│   ├── test_database.py             # 25 tests
│   ├── test_job_scheduler.py        # 10 tests
│   ├── test_pending_reviews.py      # 15 tests
│   └── test_translation.py          # 8 tests
├── test_agents/
│   ├── test_ocr_agent.py            # 10 tests
│   ├── test_title_agent.py          # 10 tests
│   ├── test_correspondent.py        # 10 tests
│   ├── test_document_type.py        # 10 tests
│   ├── test_tags_agent.py           # 10 tests
│   ├── test_custom_fields.py        # 10 tests
│   └── test_schema_analysis.py      # 10 tests
└── test_jobs/
    ├── test_bootstrap.py            # 10 tests
    ├── test_schema_cleanup.py       # 8 tests
    ├── test_metadata_enhance.py     # 8 tests
    └── test_bulk_ocr.py             # 8 tests
```

### 2.2 Critical Functions to Test

#### PaperlessClient (30+ functions) - `services/paperless.py`
```python
# test_services/test_paperless.py
class TestPaperlessClient:
    async def test_request_success(self): ...
    async def test_request_auth_error(self): ...
    async def test_get_document(self): ...
    async def test_get_document_not_found(self): ...
    async def test_get_documents_by_tag(self): ...
    async def test_get_documents_by_tags_multiple(self): ...
    async def test_get_queue_stats(self): ...
    async def test_update_document(self): ...
    async def test_add_tag_to_document(self): ...
    async def test_remove_tag_from_document(self): ...
    async def test_get_or_create_tag_existing(self): ...
    async def test_get_or_create_tag_new(self): ...
    async def test_get_or_create_correspondent(self): ...
    async def test_get_correspondents(self): ...
    async def test_get_document_types(self): ...
    async def test_get_custom_fields(self): ...
    async def test_merge_entities(self): ...
    async def test_delete_entity(self): ...
    # ... 12 more tests
```

#### DatabaseService (25+ functions) - `services/database.py`
```python
# test_services/test_database.py
class TestDatabaseService:
    async def test_get_tag_metadata(self): ...
    async def test_get_all_tag_metadata(self): ...
    async def test_upsert_tag_metadata_insert(self): ...
    async def test_upsert_tag_metadata_update(self): ...
    async def test_delete_tag_metadata(self): ...
    async def test_get_custom_field_metadata(self): ...
    async def test_upsert_custom_field_metadata(self): ...
    async def test_get_translation_exists(self): ...
    async def test_get_translation_missing(self): ...
    async def test_upsert_translation(self): ...
    async def test_get_blocked_suggestions(self): ...
    async def test_add_blocked_suggestion(self): ...
    async def test_remove_blocked_suggestion(self): ...
    async def test_is_suggestion_blocked_true(self): ...
    async def test_is_suggestion_blocked_false(self): ...
    # ... 10 more tests
```

#### Agents (10 tests each)
```python
# test_agents/test_title_agent.py
class TestTitleAgent:
    async def test_process_success(self): ...
    async def test_process_confirmation_loop_retry(self): ...
    async def test_process_max_retries_exceeded(self): ...
    async def test_process_with_similar_docs(self): ...
    async def test_generate_prompt(self): ...
    async def test_analyze_with_thinking(self): ...
    async def test_confirm_accepted(self): ...
    async def test_confirm_rejected_with_feedback(self): ...
    async def test_stream_events(self): ...
    async def test_error_handling(self): ...
```

---

## Phase 3: TypeScript Backend Architecture

### 3.1 New Package Structure
```
apps/backend-ts/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                     # Entry point
│   ├── server.ts                    # Effect HTTP server
│   │
│   ├── config/
│   │   ├── index.ts                 # Config service
│   │   ├── schema.ts                # Effect Schema for config
│   │   └── yaml-loader.ts           # YAML loading with Effect
│   │
│   ├── services/
│   │   ├── index.ts                 # Service exports
│   │   ├── PaperlessService.ts      # ~400 lines (30+ methods)
│   │   ├── OllamaService.ts         # ~200 lines
│   │   ├── MistralService.ts        # ~150 lines
│   │   ├── QdrantService.ts         # ~200 lines
│   │   ├── TinyBaseService.ts       # ~300 lines (DB + sync)
│   │   ├── PromptService.ts         # ~150 lines
│   │   └── JobSchedulerService.ts   # ~200 lines
│   │
│   ├── layers/
│   │   ├── index.ts                 # Layer composition
│   │   ├── ConfigLayer.ts           # Config loading layer
│   │   ├── HttpLayer.ts             # HTTP client layer
│   │   ├── DatabaseLayer.ts         # TinyBase layer
│   │   └── AppLayer.ts              # Full app composition
│   │
│   ├── api/
│   │   ├── index.ts                 # Router composition
│   │   ├── settings/
│   │   │   ├── api.ts               # HttpApi definition
│   │   │   └── handlers.ts          # Effect handlers
│   │   ├── documents/
│   │   ├── processing/
│   │   ├── prompts/
│   │   ├── pending/
│   │   ├── metadata/
│   │   ├── translation/
│   │   ├── schema/
│   │   └── jobs/
│   │
│   ├── agents/
│   │   ├── index.ts
│   │   ├── base.ts                  # Shared agent patterns
│   │   ├── OcrAgent.ts
│   │   ├── TitleAgent.ts
│   │   ├── CorrespondentAgent.ts
│   │   ├── DocumentTypeAgent.ts
│   │   ├── TagsAgent.ts
│   │   ├── CustomFieldsAgent.ts
│   │   ├── SchemaAnalysisAgent.ts
│   │   └── pipeline/
│   │       └── ProcessingPipeline.ts
│   │
│   ├── jobs/
│   │   ├── index.ts
│   │   ├── BootstrapJob.ts
│   │   ├── SchemaCleanupJob.ts
│   │   ├── MetadataEnhancementJob.ts
│   │   └── BulkOcrJob.ts
│   │
│   ├── models/
│   │   ├── index.ts
│   │   ├── Document.ts
│   │   ├── PendingReview.ts
│   │   ├── Settings.ts
│   │   └── JobStatus.ts
│   │
│   └── errors/
│       ├── index.ts
│       ├── PaperlessError.ts
│       ├── OllamaError.ts
│       └── ValidationError.ts
│
└── tests/
    ├── setup.ts
    ├── services/
    ├── api/
    ├── agents/
    └── jobs/
```

### 3.2 Effect-TS Service Pattern

**Example: PaperlessService**
```typescript
// src/services/PaperlessService.ts
import { Effect, Context, Layer, Config } from 'effect';
import { HttpClient, HttpClientRequest } from '@effect/platform';

// Service interface
export interface PaperlessService {
  readonly getDocument: (id: number) => Effect.Effect<Document, PaperlessError>;
  readonly getDocumentsByTag: (tag: string, limit?: number) => Effect.Effect<Document[], PaperlessError>;
  readonly updateDocument: (id: number, updates: DocumentUpdate) => Effect.Effect<Document, PaperlessError>;
  readonly addTag: (docId: number, tagName: string) => Effect.Effect<void, PaperlessError>;
  readonly removeTag: (docId: number, tagName: string) => Effect.Effect<void, PaperlessError>;
  readonly getOrCreateTag: (name: string) => Effect.Effect<Tag, PaperlessError>;
  readonly getOrCreateCorrespondent: (name: string) => Effect.Effect<Correspondent, PaperlessError>;
  readonly getOrCreateDocumentType: (name: string) => Effect.Effect<DocumentType, PaperlessError>;
  readonly getCorrespondents: () => Effect.Effect<Correspondent[], PaperlessError>;
  readonly getDocumentTypes: () => Effect.Effect<DocumentType[], PaperlessError>;
  readonly getTags: () => Effect.Effect<Tag[], PaperlessError>;
  readonly getCustomFields: () => Effect.Effect<CustomField[], PaperlessError>;
  readonly getQueueStats: () => Effect.Effect<QueueStats, PaperlessError>;
  readonly downloadPdf: (docId: number) => Effect.Effect<Uint8Array, PaperlessError>;
  readonly mergeEntities: (type: EntityType, sourceId: number, targetId: number) => Effect.Effect<void, PaperlessError>;
  readonly deleteEntity: (type: EntityType, id: number) => Effect.Effect<void, PaperlessError>;
  // ... 15+ more methods
}

// Service tag
export const PaperlessService = Context.GenericTag<PaperlessService>('PaperlessService');

// Live implementation
export const PaperlessServiceLive = Layer.effect(
  PaperlessService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const httpClient = yield* HttpClient.HttpClient;

    const request = <T>(method: string, path: string, body?: unknown) =>
      HttpClientRequest.make(method)(`${config.paperlessUrl}/api${path}`)
        .pipe(
          HttpClientRequest.setHeader('Authorization', `Token ${config.paperlessToken}`),
          body ? HttpClientRequest.jsonBody(body) : (r) => r,
          httpClient.execute,
          Effect.flatMap((res) => res.json),
          Effect.mapError((e) => new PaperlessError({ cause: e }))
        ) as Effect.Effect<T, PaperlessError>;

    return {
      getDocument: (id) => request<Document>('GET', `/documents/${id}/`),

      getDocumentsByTag: (tag, limit = 50) =>
        Effect.gen(function* () {
          const tagId = yield* getTagId(tag);
          const result = yield* request<PaginatedResult<Document>>('GET', `/documents/?tags__id=${tagId}&page_size=${limit}`);
          return result.results;
        }),

      updateDocument: (id, updates) =>
        request<Document>('PATCH', `/documents/${id}/`, updates),

      // ... implement all methods
    };
  })
);
```

### 3.3 TinyBase Backend Schema

```typescript
// src/services/TinyBaseService.ts
import { createStore, Store } from 'tinybase';
import { createWsServer } from 'tinybase/synchronizers/synchronizer-ws-server';
import { Effect, Context, Layer } from 'effect';

export const storeSchema = {
  pendingReviews: {
    id: { type: 'string' },
    docId: { type: 'number' },
    docTitle: { type: 'string' },
    type: { type: 'string' }, // correspondent | document_type | tag | schema_*
    suggestion: { type: 'string' },
    reasoning: { type: 'string' },
    alternatives: { type: 'string' }, // JSON array
    attempts: { type: 'number' },
    lastFeedback: { type: 'string' },
    nextTag: { type: 'string' },
    metadata: { type: 'string' }, // JSON object
    createdAt: { type: 'string' },
  },

  tagMetadata: {
    id: { type: 'number' },
    paperlessTagId: { type: 'number' },
    tagName: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string' },
    excludeFromAi: { type: 'boolean' },
  },

  customFieldMetadata: {
    id: { type: 'number' },
    paperlessFieldId: { type: 'number' },
    fieldName: { type: 'string' },
    description: { type: 'string' },
    extractionHints: { type: 'string' },
    valueFormat: { type: 'string' },
    exampleValues: { type: 'string' }, // JSON array
  },

  blockedSuggestions: {
    id: { type: 'number' },
    suggestionName: { type: 'string' },
    normalizedName: { type: 'string' },
    blockType: { type: 'string' }, // global | correspondent | document_type | tag
    rejectionReason: { type: 'string' },
    rejectionCategory: { type: 'string' },
    docId: { type: 'number' },
    createdAt: { type: 'string' },
  },

  translations: {
    key: { type: 'string' }, // composite key
    sourceLang: { type: 'string' },
    targetLang: { type: 'string' },
    sourceText: { type: 'string' },
    translatedText: { type: 'string' },
    modelUsed: { type: 'string' },
    createdAt: { type: 'string' },
  },

  jobStatus: {
    name: { type: 'string' },
    status: { type: 'string' },
    lastRun: { type: 'string' },
    lastResult: { type: 'string' }, // JSON
    nextRun: { type: 'string' },
    enabled: { type: 'boolean' },
    schedule: { type: 'string' },
    cron: { type: 'string' },
  },

  settings: {
    key: { type: 'string' },
    value: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

export interface TinyBaseService {
  readonly store: Store;
  readonly getPendingReviews: (type?: string) => Effect.Effect<PendingReview[]>;
  readonly addPendingReview: (item: PendingReview) => Effect.Effect<void>;
  readonly updatePendingReview: (id: string, updates: Partial<PendingReview>) => Effect.Effect<void>;
  readonly removePendingReview: (id: string) => Effect.Effect<void>;
  readonly getPendingCounts: () => Effect.Effect<PendingCounts>;
  readonly getTagMetadata: (tagId: number) => Effect.Effect<TagMetadata | null>;
  readonly getAllTagMetadata: () => Effect.Effect<TagMetadata[]>;
  readonly upsertTagMetadata: (data: TagMetadata) => Effect.Effect<void>;
  readonly deleteTagMetadata: (tagId: number) => Effect.Effect<void>;
  readonly getBlockedSuggestions: (type?: string) => Effect.Effect<BlockedSuggestion[]>;
  readonly addBlockedSuggestion: (item: BlockedSuggestion) => Effect.Effect<void>;
  readonly removeBlockedSuggestion: (id: number) => Effect.Effect<void>;
  readonly isBlocked: (name: string, type: string) => Effect.Effect<boolean>;
  readonly getTranslation: (key: TranslationKey) => Effect.Effect<Translation | null>;
  readonly setTranslation: (translation: Translation) => Effect.Effect<void>;
  readonly startSyncServer: (port: number) => Effect.Effect<void>;
}
```

### 3.4 API Router Pattern

```typescript
// src/api/pending/api.ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform';
import { Schema } from 'effect';

const PendingItemSchema = Schema.Struct({
  id: Schema.String,
  docId: Schema.Number,
  docTitle: Schema.String,
  type: Schema.Literal('correspondent', 'document_type', 'tag', 'schema_merge', 'schema_delete'),
  suggestion: Schema.String,
  reasoning: Schema.String,
  alternatives: Schema.Array(Schema.String),
  attempts: Schema.Number,
  lastFeedback: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

const PendingCountsSchema = Schema.Struct({
  correspondent: Schema.Number,
  document_type: Schema.Number,
  tag: Schema.Number,
  schema: Schema.Number,
  total: Schema.Number,
});

export const PendingApi = HttpApiGroup.make('pending')
  .add(
    HttpApiEndpoint.get('list', '/api/pending')
      .addSuccess(Schema.Array(PendingItemSchema))
  )
  .add(
    HttpApiEndpoint.get('counts', '/api/pending/counts')
      .addSuccess(PendingCountsSchema)
  )
  .add(
    HttpApiEndpoint.get('byId', '/api/pending/:id')
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(PendingItemSchema)
  )
  .add(
    HttpApiEndpoint.post('approve', '/api/pending/:id/approve')
      .setPath(Schema.Struct({ id: Schema.String }))
      .setPayload(Schema.Struct({
        action: Schema.optional(Schema.String),
        value: Schema.optional(Schema.String),
      }))
      .addSuccess(Schema.Struct({ success: Schema.Boolean }))
  )
  .add(
    HttpApiEndpoint.post('reject', '/api/pending/:id/reject')
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(Schema.Struct({ success: Schema.Boolean }))
  )
  .add(
    HttpApiEndpoint.post('rejectWithFeedback', '/api/pending/:id/reject-with-feedback')
      .setPath(Schema.Struct({ id: Schema.String }))
      .setPayload(Schema.Struct({
        feedback: Schema.optional(Schema.String),
        category: Schema.optional(Schema.String),
        blockGlobally: Schema.optional(Schema.Boolean),
      }))
      .addSuccess(Schema.Struct({ success: Schema.Boolean }))
  )
  .add(
    HttpApiEndpoint.get('similar', '/api/pending/similar')
      .addSuccess(Schema.Array(SimilarGroupSchema))
  )
  .add(
    HttpApiEndpoint.post('merge', '/api/pending/merge')
      .setPayload(Schema.Struct({
        ids: Schema.Array(Schema.String),
        targetValue: Schema.String,
      }))
      .addSuccess(Schema.Struct({ merged: Schema.Number }))
  );
```

---

## Phase 4: Agent Migration (LangChain.js)

### 4.1 Agent Pattern with Effect-TS

```typescript
// src/agents/TitleAgent.ts
import { Effect, Stream, Context, Layer } from 'effect';
import { ChatOllama } from '@langchain/ollama';
import { StructuredOutputParser } from '@langchain/core/output_parsers';

export interface TitleAgent {
  readonly process: (docId: number, content: string) => Effect.Effect<TitleResult, AgentError>;
  readonly processStream: (docId: number, content: string) => Stream.Stream<StreamEvent, AgentError>;
}

export const TitleAgent = Context.GenericTag<TitleAgent>('TitleAgent');

export const TitleAgentLive = Layer.effect(
  TitleAgent,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const qdrant = yield* QdrantService;
    const prompts = yield* PromptService;

    const largeModel = new ChatOllama({
      baseUrl: config.ollamaUrl,
      model: config.ollamaModelLarge,
      temperature: 0.1,
    });

    const smallModel = new ChatOllama({
      baseUrl: config.ollamaUrl,
      model: config.ollamaModelSmall,
      temperature: 0.0,
    });

    const analyzeTitle = (content: string, similarDocs: SimilarDoc[], feedback: string | null) =>
      Effect.gen(function* () {
        const prompt = yield* prompts.get('title_analysis', config.language);
        const filledPrompt = prompt
          .replace('{{content}}', content.slice(0, 8000))
          .replace('{{similar_docs}}', JSON.stringify(similarDocs))
          .replace('{{feedback}}', feedback || 'None');

        const parser = StructuredOutputParser.fromZodSchema(TitleAnalysisSchema);
        const result = yield* Effect.tryPromise(() => largeModel.invoke(filledPrompt));
        return yield* Effect.tryPromise(() => parser.parse(result.content as string));
      });

    const confirmTitle = (content: string, analysis: TitleAnalysis) =>
      Effect.gen(function* () {
        const prompt = yield* prompts.get('title_confirmation', config.language);
        const filledPrompt = prompt
          .replace('{{content}}', content.slice(0, 4000))
          .replace('{{suggested_title}}', analysis.suggestedTitle)
          .replace('{{reasoning}}', analysis.reasoning);

        const parser = StructuredOutputParser.fromZodSchema(ConfirmationSchema);
        const result = yield* Effect.tryPromise(() => smallModel.invoke(filledPrompt));
        return yield* Effect.tryPromise(() => parser.parse(result.content as string));
      });

    return {
      process: (docId, content) =>
        Effect.gen(function* () {
          const similarDocs = yield* qdrant.searchSimilar(content.slice(0, 2000), 5);

          let feedback: string | null = null;
          let lastAnalysis: TitleAnalysis | null = null;

          for (let attempt = 0; attempt < config.confirmationMaxRetries; attempt++) {
            const analysis = yield* analyzeTitle(content, similarDocs, feedback);
            lastAnalysis = analysis;

            const confirmation = yield* confirmTitle(content, analysis);

            if (confirmation.confirmed) {
              yield* paperless.updateDocument(docId, { title: analysis.suggestedTitle });
              yield* paperless.removeTag(docId, config.tags.documentTypeDone);
              yield* paperless.addTag(docId, config.tags.titleDone);

              return { success: true, title: analysis.suggestedTitle, attempts: attempt + 1 };
            }

            feedback = confirmation.feedback;
          }

          return {
            success: false,
            needsReview: true,
            suggestedTitle: lastAnalysis!.suggestedTitle,
            attempts: config.confirmationMaxRetries,
          };
        }),

      processStream: (docId, content) =>
        Stream.asyncEffect((emit) =>
          Effect.gen(function* () {
            yield* emit.single({ type: 'start', step: 'title' });
            // ... streaming implementation
          })
        ),
    };
  })
);
```

### 4.2 All Agents to Implement

| Agent | Methods | Python Lines | Key Dependencies |
|-------|---------|--------------|------------------|
| OcrAgent | `process`, `processWithMistral` | ~400 | MistralService |
| TitleAgent | `process`, `processStream` | ~350 | OllamaService, QdrantService |
| CorrespondentAgent | `process`, `processStream` | ~350 | OllamaService, PaperlessService |
| DocumentTypeAgent | `process`, `processStream` | ~350 | OllamaService, PaperlessService |
| TagsAgent | `process`, `processStream` | ~400 | OllamaService, PaperlessService |
| CustomFieldsAgent | `process`, `extractFields` | ~300 | OllamaService |
| SchemaAnalysisAgent | `analyze`, `suggestSchema` | ~350 | OllamaService |
| ProcessingPipeline | `processDocument`, `streamProcess` | ~600 | All agents |

---

## Phase 5: Background Jobs Migration

### 5.1 Job Pattern with Effect-TS

```typescript
// src/jobs/BootstrapJob.ts
import { Effect, Fiber, Ref } from 'effect';

export interface BootstrapProgress {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  total: number;
  processed: number;
  suggestionsFound: number;
  errors: number;
  currentDocId: number | null;
  currentDocTitle: string | null;
}

export interface BootstrapJob {
  readonly start: (analysisType: 'full' | 'schema_only') => Effect.Effect<void, JobError>;
  readonly getProgress: () => Effect.Effect<BootstrapProgress>;
  readonly cancel: () => Effect.Effect<void>;
  readonly skip: (count?: number) => Effect.Effect<void>;
}

export const BootstrapJob = Context.GenericTag<BootstrapJob>('BootstrapJob');

export const BootstrapJobLive = Layer.effect(
  BootstrapJob,
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const schemaAgent = yield* SchemaAnalysisAgent;

    const progressRef = yield* Ref.make<BootstrapProgress>({
      status: 'idle',
      total: 0,
      processed: 0,
      suggestionsFound: 0,
      errors: 0,
      currentDocId: null,
      currentDocTitle: null,
    });

    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, JobError> | null>(null);
    const skipCountRef = yield* Ref.make(0);

    return {
      start: (analysisType) =>
        Effect.gen(function* () {
          const currentFiber = yield* Ref.get(fiberRef);
          if (currentFiber) {
            yield* Effect.fail(new JobError('Job already running'));
          }

          const documents = yield* paperless.getAllDocuments();
          yield* Ref.set(progressRef, {
            status: 'running',
            total: documents.length,
            processed: 0,
            suggestionsFound: 0,
            errors: 0,
            currentDocId: null,
            currentDocTitle: null,
          });

          const fiber = yield* Effect.fork(
            Effect.forEach(documents, (doc) =>
              Effect.gen(function* () {
                const skipCount = yield* Ref.get(skipCountRef);
                if (skipCount > 0) {
                  yield* Ref.update(skipCountRef, (n) => n - 1);
                  return;
                }

                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  currentDocId: doc.id,
                  currentDocTitle: doc.title,
                }));

                const result = yield* schemaAgent.analyze(doc).pipe(
                  Effect.catchAll(() => Effect.succeed({ suggestions: [] }))
                );

                for (const suggestion of result.suggestions) {
                  yield* tinybase.addPendingReview(suggestion);
                }

                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  processed: p.processed + 1,
                  suggestionsFound: p.suggestionsFound + result.suggestions.length,
                }));
              }).pipe(
                Effect.catchAll(() =>
                  Ref.update(progressRef, (p) => ({ ...p, errors: p.errors + 1 }))
                )
              )
            )
          );

          yield* Ref.set(fiberRef, fiber);
        }),

      getProgress: () => Ref.get(progressRef),

      cancel: () =>
        Effect.gen(function* () {
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(fiberRef, null);
            yield* Ref.update(progressRef, (p) => ({ ...p, status: 'cancelled' }));
          }
        }),

      skip: (count = 1) => Ref.update(skipCountRef, (n) => n + count),
    };
  })
);
```

### 5.2 All Jobs to Implement

| Job | Methods | Triggers |
|-----|---------|----------|
| BootstrapJob | `start`, `getProgress`, `cancel`, `skip` | Manual |
| SchemaCleanupJob | `run`, `getStatus` | Scheduled (cron) |
| MetadataEnhancementJob | `run`, `getStatus` | Scheduled (cron) |
| BulkOcrJob | `start`, `getProgress`, `cancel` | Manual |

---

## Phase 6: Vitest Tests (Matching Python Tests)

### 6.1 Vitest Configuration

```typescript
// apps/backend-ts/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'tests/fixtures'],
    },
    setupFiles: ['./tests/setup.ts'],
  },
});
```

### 6.2 Test Directory Structure
```
apps/backend-ts/tests/
├── setup.ts                         # Test fixtures and mocks
├── services/
│   ├── PaperlessService.test.ts     # 30 tests
│   ├── QdrantService.test.ts        # 15 tests
│   ├── TinyBaseService.test.ts      # 25 tests
│   ├── JobSchedulerService.test.ts  # 10 tests
│   ├── PromptService.test.ts        # 8 tests
│   └── TranslationService.test.ts   # 8 tests
├── api/
│   ├── settings.test.ts             # 15 tests
│   ├── documents.test.ts            # 10 tests
│   ├── processing.test.ts           # 8 tests
│   ├── prompts.test.ts              # 12 tests
│   ├── pending.test.ts              # 25 tests
│   ├── metadata.test.ts             # 15 tests
│   ├── translation.test.ts          # 8 tests
│   ├── schema.test.ts               # 6 tests
│   └── jobs.test.ts                 # 20 tests
├── agents/
│   ├── OcrAgent.test.ts             # 10 tests
│   ├── TitleAgent.test.ts           # 10 tests
│   ├── CorrespondentAgent.test.ts   # 10 tests
│   ├── DocumentTypeAgent.test.ts    # 10 tests
│   ├── TagsAgent.test.ts            # 10 tests
│   ├── CustomFieldsAgent.test.ts    # 10 tests
│   └── SchemaAnalysisAgent.test.ts  # 10 tests
└── jobs/
    ├── BootstrapJob.test.ts         # 10 tests
    ├── SchemaCleanupJob.test.ts     # 8 tests
    ├── MetadataEnhancement.test.ts  # 8 tests
    └── BulkOcrJob.test.ts           # 8 tests
```

### 6.3 Test Parity Checklist

Create `tests/parity-checklist.md` to track:
```markdown
## Service Tests
| Python Test | TypeScript Test | Status |
|-------------|-----------------|--------|
| test_paperless_get_document | PaperlessService.test.ts:getDocument | pending |
| test_paperless_get_documents_by_tag | PaperlessService.test.ts:getDocumentsByTag | pending |
...
```

---

## Phase 7: Integration & Migration

### 7.1 Parallel Backend Running
1. Python backend: port 8000
2. TypeScript backend: port 8001
3. Feature flag in frontend: `NEXT_PUBLIC_BACKEND_URL`

### 7.2 Data Migration Script
```typescript
// scripts/migrate-data.ts
import { createStore } from 'tinybase';
import Database from 'better-sqlite3';

async function migrate() {
  const sqlite = new Database('apps/backend/data/app.db');
  const tinybase = createStore();

  // Migrate pending reviews
  const pendingRows = sqlite.prepare('SELECT * FROM pending_reviews').all();
  for (const row of pendingRows) {
    tinybase.setRow('pendingReviews', row.id, row);
  }

  // Migrate tag metadata
  const tagRows = sqlite.prepare('SELECT * FROM tag_metadata').all();
  for (const row of tagRows) {
    tinybase.setRow('tagMetadata', String(row.id), row);
  }

  // ... migrate other tables

  // Save to file
  const json = tinybase.getJson();
  await fs.writeFile('data/tinybase-store.json', json);
}
```

### 7.3 Final Cleanup
1. Remove `apps/backend/` (Python)
2. Rename `apps/backend-ts/` to `apps/backend/`
3. Update Docker configuration
4. Update CI/CD pipelines
5. Update documentation

---

## Ralph Loop Command

```
/ralph-loop Execute the Paperless Local LLM full-stack rewrite.

## Autonomous Execution Instructions

You are executing a comprehensive full-stack rewrite. Follow these phases IN ORDER.
After completing each phase, verify success before proceeding.

### Self-Verification Commands
- Run tests: `pnpm test`
- Run E2E: `pnpm test:e2e`
- Start backend: `cd apps/backend-ts && pnpm dev` (background)
- Start frontend: `pnpm dev:web` (background)
- Check types: `pnpm typecheck`
- Verify sync: Test TinyBase WebSocket connection

### Phase Execution Order

**PHASE 0**: Foundation
- Create worktree: `git worktree add ../paperless-rewrite feature/full-stack-rewrite`
- Switch to pnpm: Delete bun.lock, update package.json, run `pnpm install`
- Update turbo.json with precommit task
- Update .pre-commit-config.yaml to use turbo
- VERIFY: `pnpm install` succeeds, `pnpm turbo run build` works

**PHASE 1**: Frontend Restructuring
- Split settings/page.tsx into 10+ components in components/settings/
- Split pending/page.tsx into 6+ components in components/pending/
- Split lib/api.ts into lib/api/* modules
- Split other large pages (documents/[id], dashboard, prompts)
- Install TinyBase: `pnpm add tinybase -w --filter @repo/web`
- Create store/index.ts and store/hooks.ts
- Setup Playwright: `pnpm add -D @playwright/test --filter @repo/web`
- Write E2E tests for all pages
- VERIFY: `pnpm dev:web` works, E2E tests pass

**PHASE 2**: Python Tests
- Create test fixtures in apps/backend/tests/conftest.py
- Write tests for all services (30+ tests each)
- Write tests for all routers (15+ tests each)
- Write tests for all agents (10 tests each)
- Write tests for all jobs (8-10 tests each)
- VERIFY: `cd apps/backend && uv run pytest` - all pass

**PHASE 3**: TypeScript Backend
- Create apps/backend-ts/ package structure
- Implement Effect-TS services (PaperlessService, TinyBaseService, etc.)
- Implement Effect layers (ConfigLayer, HttpLayer, DatabaseLayer)
- Implement API routers with HttpApi
- VERIFY: `cd apps/backend-ts && pnpm dev` starts server

**PHASE 4**: Agent Migration
- Implement all agents with LangChain.js
- Port confirmation loop logic
- Implement ProcessingPipeline
- VERIFY: Test agent processing manually

**PHASE 5**: Jobs Migration
- Implement all background jobs
- Port scheduling logic
- VERIFY: Jobs can be triggered and tracked

**PHASE 6**: Vitest Tests
- Write matching tests for ALL Python tests
- Ensure test parity
- VERIFY: `pnpm test` passes all tests

**PHASE 7**: Integration
- Run both backends in parallel
- Test feature parity
- Migrate data from SQLite to TinyBase
- Remove Python backend
- VERIFY: Full application works end-to-end

### Key Files Reference
- Python PaperlessClient: apps/backend/services/paperless.py
- Python DatabaseService: apps/backend/services/database.py
- Python TitleAgent: apps/backend/agents/title_agent.py
- Python Pipeline: apps/backend/agents/pipeline.py
- Frontend Settings: apps/web/app/settings/page.tsx
- Frontend API: apps/web/lib/api.ts

### Commit Strategy
After completing each phase:
1. Run `pnpm turbo run precommit`
2. If passes, commit: `git commit -m "phase X: description"`
3. Push to feature branch

### Error Recovery
- If tests fail: Fix issues before proceeding
- If build fails: Check TypeScript errors, fix imports
- If E2E fails: Check if servers are running
- If sync fails: Verify TinyBase WebSocket server
```

---

## Verification Checklist

### Per-Phase Verification

**Phase 0**:
- [ ] `pnpm install` completes without errors
- [ ] `pnpm turbo run build` succeeds
- [ ] Pre-commit hooks run with turbo

**Phase 1**:
- [ ] settings/page.tsx < 200 lines
- [ ] pending/page.tsx < 300 lines
- [ ] lib/api/index.ts exports all APIs
- [ ] TinyBase store initializes
- [ ] All E2E tests pass
- [ ] No functionality regression

**Phase 2**:
- [ ] 300+ Python tests written
- [ ] All tests pass
- [ ] Coverage > 80%

**Phase 3**:
- [ ] TypeScript backend starts
- [ ] All API endpoints respond
- [ ] TinyBase sync server running

**Phase 4**:
- [ ] All agents process documents
- [ ] Confirmation loop works
- [ ] Streaming events work

**Phase 5**:
- [ ] All jobs can start
- [ ] Progress tracking works
- [ ] Cancellation works

**Phase 6**:
- [ ] Test parity achieved
- [ ] All Vitest tests pass
- [ ] Coverage > 80%

**Phase 7**:
- [ ] Both backends work in parallel
- [ ] Data migration complete
- [ ] Real-time sync working
- [ ] Python backend removed
- [ ] Full E2E test suite passes

---

## Files Critical for Implementation

### Python Files to Reference (in order of importance)

1. **`apps/backend/services/paperless.py`** (562 lines)
   - Core Paperless-ngx API client
   - 30+ methods to port

2. **`apps/backend/services/database.py`** (568 lines)
   - SQLite operations to replace with TinyBase
   - 25+ methods

3. **`apps/backend/agents/pipeline.py`** (28KB)
   - Processing orchestration
   - Tag-based state machine

4. **`apps/backend/agents/title_agent.py`**
   - Confirmation loop pattern
   - LLM integration

5. **`apps/backend/config.py`**
   - 170+ configuration fields
   - YAML loading logic

### Frontend Files to Refactor

1. **`apps/web/app/settings/page.tsx`** (3,400 lines) - CRITICAL
2. **`apps/web/app/pending/page.tsx`** (1,746 lines) - HIGH
3. **`apps/web/lib/api.ts`** (779 lines) - MEDIUM
4. **`apps/web/app/documents/[id]/page.tsx`** (485 lines)
5. **`apps/web/app/page.tsx`** (459 lines)
6. **`apps/web/app/prompts/page.tsx`** (487 lines)
