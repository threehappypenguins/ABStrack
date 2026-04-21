/**
 * Universal entry: types, env, React Native client, auth, and queries.
 * Does **not** import `@supabase/ssr` — safe for Metro without pulling Next SSR code.
 *
 * Next.js: import browser/server factories from `@abstrack/supabase/browser` and
 * `@abstrack/supabase/server`.
 */
export type { Database, Json } from './lib/database.types.js';
export type {
  HealthMarkersInsert,
  HealthMarkersUpdate,
} from './lib/health-markers-db-write-types.js';
export type { Session } from '@supabase/supabase-js';
export { getSupabasePublishableKey, getSupabaseUrl } from './lib/env-public.js';
export type { AbstrackSupabaseClient } from './lib/supabase-client-type.js';
export {
  createSupabaseNativeClient,
  type NativeAuthStorage,
  type NativeClientOptions,
} from './lib/native-client.js';
export {
  getAuthUser,
  getSession,
  resetPasswordForEmail,
  signInWithEmailPassword,
  signOut,
  signUpWithEmailPassword,
  updateUserPassword,
  updatePassword,
} from './lib/auth.js';
export {
  fetchProfileByUserId,
  healthCheckProfilesLimit1,
} from './lib/queries.js';
export type {
  AbstrackAccessTokenClaims,
  PractitionerAppGate,
} from './lib/session-claims.js';
export {
  hasMfaAssuranceAal2,
  parseAbstrackAccessTokenClaims,
  parseProfileAppRole,
  resolvePractitionerAppGate,
} from './lib/session-claims.js';
export type { PresetDataErrorCode } from './lib/preset-data-error.js';
export {
  PresetDataError,
  mapSupabaseErrorToPresetDataError,
  toPresetDataError,
} from './lib/preset-data-error.js';
export type { PresetDataResult } from './lib/preset-data.js';
export {
  createHealthMarkerPreset,
  createPresetHealthMarker,
  createPresetSymptom,
  createSymptomPreset,
  deleteHealthMarkerPreset,
  deletePresetHealthMarker,
  deletePresetSymptom,
  deleteSymptomPreset,
  getHealthMarkerPresetById,
  getSymptomPresetById,
  listHealthMarkerPresets,
  listPresetHealthMarkersForPreset,
  listPresetSymptomsForPreset,
  listSymptomPresets,
  reorderPresetHealthMarkers,
  reorderPresetSymptoms,
  updateHealthMarkerPreset,
  updatePresetHealthMarker,
  updatePresetSymptom,
  updateSymptomPreset,
  validateReorderLineIds,
} from './lib/preset-data.js';
export {
  createEpisodeTemplate,
  deleteEpisodeTemplate,
  getEpisodeTemplateById,
  listEpisodeTemplates,
  updateEpisodeTemplate,
} from './lib/episode-template-data.js';
export {
  cancelActiveEpisodeById,
  createEpisode,
  deleteEpisodeById,
  endEpisodeIfStillActive,
  getActiveEpisodeForUser,
  getEpisodeById,
  listCompletedEpisodesForUser,
} from './lib/episode-data.js';
export {
  deleteEpisodeSymptomAnswer,
  listEpisodeSymptomsForEpisode,
  upsertEpisodeSymptomAnswer,
} from './lib/episode-symptom-data.js';
export {
  listEpisodeHealthMarkersForEpisode,
  upsertEpisodeHealthMarkerForLine,
} from './lib/episode-health-marker-data.js';
