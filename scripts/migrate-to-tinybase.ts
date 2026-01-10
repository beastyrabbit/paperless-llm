#!/usr/bin/env tsx
/**
 * Data Migration Script: SQLite/JSON to TinyBase
 *
 * Migrates data from the Python backend's storage to the TypeScript backend's TinyBase.
 *
 * Source data:
 * - apps/backend/data/metadata.db (SQLite) -> tag metadata, custom field metadata, translations, blocked suggestions
 * - apps/backend/data/pending_reviews.json (JSON) -> pending review items
 *
 * Target:
 * - TinyBase stores in apps/backend-ts/data/
 *
 * Usage:
 *   pnpm tsx scripts/migrate-to-tinybase.ts
 *   pnpm tsx scripts/migrate-to-tinybase.ts --dry-run
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// ===========================================================================
// Configuration
// ===========================================================================

const PYTHON_BACKEND_DATA = join(projectRoot, 'apps/backend/data');
const TS_BACKEND_DATA = join(projectRoot, 'apps/backend-ts/data');

const SQLITE_DB_PATH = join(PYTHON_BACKEND_DATA, 'metadata.db');
const PENDING_REVIEWS_PATH = join(PYTHON_BACKEND_DATA, 'pending_reviews.json');
const TINYBASE_OUTPUT_PATH = join(TS_BACKEND_DATA, 'migrated-data.json');

const isDryRun = process.argv.includes('--dry-run');

// ===========================================================================
// Types
// ===========================================================================

interface TagMetadata {
  id: number;
  paperless_tag_id: number;
  tag_name: string;
  description: string | null;
  category: string | null;
  exclude_from_ai: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface CustomFieldMetadata {
  id: number;
  paperless_field_id: number;
  field_name: string;
  description: string | null;
  extraction_hints: string | null;
  value_format: string | null;
  example_values: string | null; // JSON string
  created_at: string | null;
  updated_at: string | null;
}

interface Translation {
  id: number;
  source_lang: string;
  target_lang: string;
  content_type: string;
  content_key: string;
  source_text: string;
  translated_text: string;
  model_used: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface BlockedSuggestion {
  id: number;
  suggestion_name: string;
  normalized_name: string;
  block_type: string;
  rejection_reason: string | null;
  rejection_category: string | null;
  doc_id: number | null;
  created_at: string | null;
}

interface PendingReviewItem {
  id: string;
  doc_id: number;
  doc_title: string;
  type: string;
  suggestion: string;
  reasoning: string;
  alternatives: string[];
  attempts: number;
  last_feedback: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  next_tag: string | null;
}

interface TinyBaseData {
  pending_reviews: Record<string, PendingReviewItem>;
  blocked_suggestions: Record<string, BlockedSuggestion>;
  tag_metadata: Record<string, TagMetadata>;
  custom_field_metadata: Record<string, CustomFieldMetadata>;
  translations: Record<string, Translation>;
  settings: Record<string, string>;
}

// ===========================================================================
// Migration Functions
// ===========================================================================

function readSqliteData(): {
  tagMetadata: TagMetadata[];
  customFieldMetadata: CustomFieldMetadata[];
  translations: Translation[];
  blockedSuggestions: BlockedSuggestion[];
} {
  if (!existsSync(SQLITE_DB_PATH)) {
    console.log('  SQLite database not found, skipping...');
    return {
      tagMetadata: [],
      customFieldMetadata: [],
      translations: [],
      blockedSuggestions: [],
    };
  }

  const db = new Database(SQLITE_DB_PATH, { readonly: true });

  let tagMetadata: TagMetadata[] = [];
  let customFieldMetadata: CustomFieldMetadata[] = [];
  let translations: Translation[] = [];
  let blockedSuggestions: BlockedSuggestion[] = [];

  try {
    // Check which tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    if (tableNames.includes('tag_metadata')) {
      tagMetadata = db.prepare('SELECT * FROM tag_metadata').all() as TagMetadata[];
      console.log(`  Found ${tagMetadata.length} tag metadata records`);
    }

    if (tableNames.includes('custom_field_metadata')) {
      customFieldMetadata = db
        .prepare('SELECT * FROM custom_field_metadata')
        .all() as CustomFieldMetadata[];
      console.log(`  Found ${customFieldMetadata.length} custom field metadata records`);
    }

    if (tableNames.includes('translations')) {
      translations = db.prepare('SELECT * FROM translations').all() as Translation[];
      console.log(`  Found ${translations.length} translation records`);
    }

    if (tableNames.includes('blocked_suggestions')) {
      blockedSuggestions = db
        .prepare('SELECT * FROM blocked_suggestions')
        .all() as BlockedSuggestion[];
      console.log(`  Found ${blockedSuggestions.length} blocked suggestion records`);
    }
  } finally {
    db.close();
  }

  return { tagMetadata, customFieldMetadata, translations, blockedSuggestions };
}

function readPendingReviews(): PendingReviewItem[] {
  if (!existsSync(PENDING_REVIEWS_PATH)) {
    console.log('  Pending reviews file not found, skipping...');
    return [];
  }

  const content = readFileSync(PENDING_REVIEWS_PATH, 'utf-8');
  const items = JSON.parse(content) as PendingReviewItem[];
  console.log(`  Found ${items.length} pending review items`);
  return items;
}

function convertToTinyBaseFormat(
  tagMetadata: TagMetadata[],
  customFieldMetadata: CustomFieldMetadata[],
  translations: Translation[],
  blockedSuggestions: BlockedSuggestion[],
  pendingReviews: PendingReviewItem[]
): TinyBaseData {
  const data: TinyBaseData = {
    pending_reviews: {},
    blocked_suggestions: {},
    tag_metadata: {},
    custom_field_metadata: {},
    translations: {},
    settings: {},
  };

  // Convert pending reviews
  for (const item of pendingReviews) {
    data.pending_reviews[item.id] = {
      ...item,
      // Ensure metadata is stored as JSON string for TinyBase
      metadata: item.metadata,
    };
  }

  // Convert blocked suggestions
  for (const item of blockedSuggestions) {
    data.blocked_suggestions[`blocked_${item.id}`] = item;
  }

  // Convert tag metadata
  for (const item of tagMetadata) {
    data.tag_metadata[`tag_${item.paperless_tag_id}`] = item;
  }

  // Convert custom field metadata
  for (const item of customFieldMetadata) {
    data.custom_field_metadata[`field_${item.paperless_field_id}`] = item;
  }

  // Convert translations
  for (const item of translations) {
    const key = `${item.source_lang}_${item.target_lang}_${item.content_type}_${item.content_key}`;
    data.translations[key] = item;
  }

  return data;
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Data Migration: Python Backend -> TypeScript Backend');
  console.log('='.repeat(60));

  if (isDryRun) {
    console.log('\n[DRY RUN MODE - No changes will be written]\n');
  }

  // Step 1: Read SQLite data
  console.log('\n1. Reading SQLite database...');
  const { tagMetadata, customFieldMetadata, translations, blockedSuggestions } = readSqliteData();

  // Step 2: Read pending reviews JSON
  console.log('\n2. Reading pending reviews JSON...');
  const pendingReviews = readPendingReviews();

  // Step 3: Convert to TinyBase format
  console.log('\n3. Converting to TinyBase format...');
  const tinybaseData = convertToTinyBaseFormat(
    tagMetadata,
    customFieldMetadata,
    translations,
    blockedSuggestions,
    pendingReviews
  );

  // Step 4: Summary
  console.log('\n4. Migration Summary:');
  console.log(`   - Pending reviews: ${Object.keys(tinybaseData.pending_reviews).length}`);
  console.log(`   - Blocked suggestions: ${Object.keys(tinybaseData.blocked_suggestions).length}`);
  console.log(`   - Tag metadata: ${Object.keys(tinybaseData.tag_metadata).length}`);
  console.log(`   - Custom field metadata: ${Object.keys(tinybaseData.custom_field_metadata).length}`);
  console.log(`   - Translations: ${Object.keys(tinybaseData.translations).length}`);

  // Step 5: Write output
  if (!isDryRun) {
    console.log('\n5. Writing TinyBase data...');

    // Ensure output directory exists
    mkdirSync(TS_BACKEND_DATA, { recursive: true });

    // Write the migrated data
    writeFileSync(TINYBASE_OUTPUT_PATH, JSON.stringify(tinybaseData, null, 2));
    console.log(`   Written to: ${TINYBASE_OUTPUT_PATH}`);

    console.log('\n[MIGRATION COMPLETE]');
    console.log('\nTo use the migrated data:');
    console.log('1. The TinyBase service will auto-load this data on startup');
    console.log('2. Or import it manually in your TinyBase setup');
  } else {
    console.log('\n[DRY RUN COMPLETE - No files written]');
    console.log('\nRun without --dry-run to perform the actual migration');
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
