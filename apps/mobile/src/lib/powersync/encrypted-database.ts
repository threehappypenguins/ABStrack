import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';

import { abstrackPowerSyncSchema } from './abstrack-app-schema';

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
    schema: abstrackPowerSyncSchema,
    database: factory,
  });
}
