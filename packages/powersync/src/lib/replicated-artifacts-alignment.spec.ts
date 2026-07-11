import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MOBILE_LOCAL_ONLY_POWER_SYNC_SCHEMA_TABLE_NAMES,
  REPLICATED_PUBLIC_TABLE_NAMES,
} from './replicated-public-tables.js';

const resolveFromSpec = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/**
 * Property names inside `new Schema({ ... })` in `abstrack-app-schema.ts`.
 * Tolerant of indentation depth and trailing commas; ignores blank lines and `//` line tails so
 * formatting-only edits don’t break alignment checks.
 */
function parsePowerSyncSchemaKeys(source: string): string[] {
  const marker = 'new Schema({';
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) {
    throw new Error('new Schema({ not found in abstrack-app-schema.ts');
  }
  const after = source.slice(startIdx + marker.length);
  const endIdx = after.indexOf('});');
  if (endIdx === -1) {
    throw new Error('Closing }); for Schema(...) not found');
  }
  const block = after.slice(0, endIdx);
  const keys: string[] = [];
  for (const line of block.split('\n')) {
    const withoutLineComment = line.replace(/\/\/.*$/, '');
    const trimmed = withoutLineComment.trim();
    if (trimmed === '') continue;
    const m = trimmed.match(/^([a-z_][a-z0-9_]*)\s*,?\s*$/);
    if (m) {
      keys.push(m[1]);
    }
  }
  return keys;
}

/** Tables referenced as `FROM tbl` / `JOIN tbl` in sync-rules SQL (uppercase keywords; avoids prose `from`). */
function tableNamesFromSqlFragments(source: string): Set<string> {
  const re = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\b/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

function parseMigrationRequiredTables(sql: string): string[] {
  const match = sql.match(
    /required_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]\s*;/,
  );
  if (!match) {
    throw new Error(
      'Migration is missing required_tables text[] := ARRAY[...]; — cannot verify allowlist alignment.',
    );
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((groups) => groups[1]);
}

/** Tables added after the base PowerSync migration via `ALTER PUBLICATION powersync ADD TABLE`. */
function parseAlterPublicationAddTables(migrationsDir: string): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) =>
    f.endsWith('.sql'),
  )) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const re =
      /\bALTER\s+PUBLICATION\s+powersync\s+ADD\s+TABLE\s+public\.([a-z_][a-z0-9_]*)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      names.add(m[1]);
    }
  }
  return [...names];
}

/**
 * Collect the PowerSync publication allowlist from migration SQL.
 * Squashed baseline embeds `required_tables`; later migrations may also
 * `ALTER PUBLICATION powersync ADD TABLE`.
 */
function publicationAllowlistFromMigrations(repoRoot: string): string[] {
  const migrationsDir = join(repoRoot, 'supabase/migrations');
  const names = new Set<string>();
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let foundRequiredTables = false;
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    if (!/\bpowersync\b/i.test(sql)) continue;
    if (!/required_tables\s+text\[\]\s*:=\s*ARRAY\[/.test(sql)) continue;
    for (const table of parseMigrationRequiredTables(sql)) {
      names.add(table);
    }
    foundRequiredTables = true;
  }
  if (!foundRequiredTables) {
    throw new Error(
      'No migration defines powersync required_tables text[] := ARRAY[...]; — cannot verify allowlist alignment.',
    );
  }
  for (const table of parseAlterPublicationAddTables(migrationsDir)) {
    names.add(table);
  }
  return [...names].sort();
}

describe('Replicated table allowlist alignment', () => {
  const allowlistSorted = [...REPLICATED_PUBLIC_TABLE_NAMES].sort();

  it('matches sync-rules.yaml FROM/JOIN references', () => {
    const yamlPath = resolveFromSpec('../../sync-rules.yaml');
    const yaml = readFileSync(yamlPath, 'utf8');
    const referenced = [...tableNamesFromSqlFragments(yaml)].sort();
    expect(referenced).toEqual(allowlistSorted);
  });

  it('matches powersync publication allowlist (baseline required_tables + ADD TABLE in later files)', () => {
    const repoRoot = resolveFromSpec('../../../../');
    const fromMigrations = publicationAllowlistFromMigrations(repoRoot);
    expect(fromMigrations).toEqual(allowlistSorted);
  });

  it('matches mobile abstrack-app-schema.ts Schema table keys', () => {
    const schemaPath = resolveFromSpec(
      '../../../../apps/mobile/src/lib/powersync/abstrack-app-schema.ts',
    );
    const ts = readFileSync(schemaPath, 'utf8');
    const keys = [...parsePowerSyncSchemaKeys(ts)].sort();
    const mobileExpected = [
      ...REPLICATED_PUBLIC_TABLE_NAMES,
      ...MOBILE_LOCAL_ONLY_POWER_SYNC_SCHEMA_TABLE_NAMES,
    ].sort();
    expect(keys).toEqual(mobileExpected);
  });
});
