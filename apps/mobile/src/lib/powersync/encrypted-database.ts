import { abstrackPowerSyncSchema } from '@abstrack/powersync';
import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase, type Schema } from '@powersync/react-native';

/**
 * Opens the ABStrack PowerSync SQLite database using OP-SQLite with SQLCipher (see `op-sqlite`
 * `sqlcipher` flag in `apps/mobile/package.json`).
 *
 * @param options.encryptionKey SQLCipher key material; derive from secure storage in production.
 * @param options.dbFilename Local SQLite filename (default `abstrack-powersync.db`).
 * @returns A `PowerSyncDatabase` — call `init()`, then `connect(connector)` before querying.
 */
export function createEncryptedAbstrackPowerSyncDatabase(options: {
  encryptionKey: string;
  dbFilename?: string;
}): PowerSyncDatabase {
  const factory = new OPSqliteOpenFactory({
    dbFilename: options.dbFilename ?? 'abstrack-powersync.db',
    sqliteOptions: {
      encryptionKey: options.encryptionKey,
    },
  });

  return new PowerSyncDatabase({
    // Nominal mismatch between workspace-built Schema and SDK Schema (`Table.options`). TS2352 rejects `as Schema` alone; `unknown` states intent. Runtime object matches PowerSyncDatabase.
    schema: abstrackPowerSyncSchema as unknown as Schema,
    database: factory,
  });
}
