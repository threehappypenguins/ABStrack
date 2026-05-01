export {
  type AppRole,
  type CaretakerGrantRow,
  type PractitionerGrantRow,
  type SyncScopeModelInput,
  visiblePatientUserIdsForPhiSync,
} from './lib/sync-scope-model.js';

export {
  type ReplicatedPublicTableName,
  REPLICATED_PUBLIC_TABLE_NAMES,
} from './lib/replicated-public-tables.js';

/** Repo-relative path to the deployable PowerSync sync rules file (YAML). */
export const ABSTRACK_POWERSYNC_SYNC_RULES_PACKAGE_PATH =
  'packages/powersync/sync-rules.yaml';
