import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REPLICATED_PUBLIC_TABLE_NAMES } from './replicated-public-tables.js';

const resolveFromSpec = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

/** Property names inside `new Schema({ ... })` in `abstrack-app-schema.ts`. */
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
    const m = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s*,?\s*$/);
    if (m) {
      keys.push(m[1]);
    }
  }
  return keys;
}

/** Tables referenced as `FROM tbl` / `JOIN tbl` in sync-rules SQL fragments (unquoted identifiers). */
function tableNamesFromSqlFragments(source: string): Set<string> {
  const re = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\b/gi;
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

describe('Replicated table allowlist alignment', () => {
  const allowlistSorted = [...REPLICATED_PUBLIC_TABLE_NAMES].sort();

  it('matches sync-rules.yaml FROM/JOIN references', () => {
    const yamlPath = resolveFromSpec('../../sync-rules.yaml');
    const yaml = readFileSync(yamlPath, 'utf8');
    const referenced = [...tableNamesFromSqlFragments(yaml)].sort();
    expect(referenced).toEqual(allowlistSorted);
  });

  it('matches powersync migration required_tables array', () => {
    const migrationPath = resolveFromSpec(
      '../../../../supabase/migrations/20260430120000_powersync_replication_role_and_publication.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');
    const fromMigration = [
      ...new Set(parseMigrationRequiredTables(sql)),
    ].sort();
    expect(fromMigration).toEqual(allowlistSorted);
  });

  it('matches mobile abstrack-app-schema.ts Schema table keys', () => {
    const schemaPath = resolveFromSpec(
      '../../../../apps/mobile/src/lib/powersync/abstrack-app-schema.ts',
    );
    const ts = readFileSync(schemaPath, 'utf8');
    const keys = [...parsePowerSyncSchemaKeys(ts)].sort();
    expect(keys).toEqual(allowlistSorted);
  });
});
