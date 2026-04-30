export {
  abstrackPowerSyncSchema,
  type AbstrackPowerSyncDatabase,
} from './lib/abstrack-app-schema.js';
export {
  type AppRole,
  type CaretakerGrantRow,
  type PractitionerGrantRow,
  type SyncScopeModelInput,
  visiblePatientUserIdsForPhiSync,
} from './lib/sync-scope-model.js';

/** Repo-relative path to the deployable PowerSync sync rules file (YAML). */
export const ABSTRACK_POWERSYNC_SYNC_RULES_PACKAGE_PATH =
  'packages/powersync/sync-rules.yaml';
