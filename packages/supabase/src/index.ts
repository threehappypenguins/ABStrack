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
export type { PhiSubjectUserContext } from './lib/phi-subject-user-id.js';
export {
  CARETAKER_MULTIPLE_ACTIVE_PATIENTS_MESSAGE,
  resolvePhiSubjectUserContextFromSupabase,
} from './lib/phi-subject-user-id.js';
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
export type {
  CancelActiveEpisodeByIdResult,
  DeleteEpisodeByIdResult,
  EpisodePostMarkerStepWrite,
} from './lib/episode-data.js';
export {
  cancelActiveEpisodeById,
  completeEpisodePostMarkerStep,
  createEpisode,
  deleteEpisodeById,
  endEpisodeIfStillActive,
  getActiveEpisodeForUser,
  getEpisodeById,
  listCompletedEpisodesForUser,
} from './lib/episode-data.js';
export {
  deleteCurrentPassEpisodeSymptomAnswer,
  insertEpisodeSymptomAnswer,
  listEpisodeSymptomsForEpisode,
} from './lib/episode-symptom-data.js';
export type {
  EpisodeMediaListRow,
  EpisodeMediaUploadBody,
  RemoveEpisodeMediaObjectsFromStorageResult,
  RemoveEpisodeMediaStorageObjectPathsResult,
} from './lib/episode-media-data.js';
export {
  createEpisodeMediaSignedDisplayUrl,
  createEpisodeMediaObjectKey,
  createEpisodeMediaThumbnailObjectKey,
  listEpisodeMediaBucketPathsForEpisodeMediaId,
  listEpisodeMediaBucketPathsForEpisodeSymptomId,
  listEpisodeMediaForEpisode,
  listEpisodeMediaStorageObjectPathsForEpisode,
  removeEpisodeMediaObjectsFromStorage,
  removeEpisodeMediaStorageObjectPathsBestEffort,
  removeEpisodeMediaStorageObjectPathsWithResult,
  uploadConfirmedEpisodeMedia,
} from './lib/episode-media-data.js';
export {
  buildHealthMarkerInsertRowForPresetLine,
  createStandaloneHealthMarkerForLine,
  deleteHealthMarkerById,
  insertEpisodeHealthMarkerForLine,
  listEpisodeHealthMarkersForEpisode,
  listStandaloneHealthMarkersForUser,
  validateHealthMarkerNumericPayload,
} from './lib/episode-health-marker-data.js';
export {
  compareEpisodeTimelineItems,
  EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN,
  EPISODE_TIMELINE_SOURCE_LIMIT,
  EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN,
  episodeTimelineBloodPressureDetailWithOptionalNotes,
  episodeTimelineBoundedFoodNote,
  episodeTimelineBoundedSymptomMarkerText,
  episodeTimelineMeasurementDetailWithOptionalNotes,
  listEpisodeObservationTimeline,
  mergeEpisodeObservationRowsToTimeline,
  mergeStandaloneHealthAndFoodRowsToTimeline,
  type EpisodeTimelineItem,
  upsertEpisodeTimelineItem,
} from './lib/episode-observation-timeline.js';
export type { PractitionerPatientDirectoryEntry } from './lib/practitioner-patient-directory-data.js';
export {
  formatPractitionerPatientDirectoryLabel,
  formatPractitionerPatientGrantedAt,
  listActivePractitionerPatientDirectory,
} from './lib/practitioner-patient-directory-data.js';
export type {
  PractitionerPatientEpisodeObservationBlock,
  PractitionerPatientEpisodeRow,
  PractitionerPatientObservationReadModel,
} from './lib/practitioner-patient-observation-read.js';
export {
  assertActivePractitionerGrantForPatient,
  loadPractitionerPatientObservationReadModel,
  PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK,
  PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
  PRACTITIONER_PATIENT_EPISODE_LIST_SELECT,
  PRACTITIONER_STANDALONE_OBSERVATION_CAP,
} from './lib/practitioner-patient-observation-read.js';
export {
  createFoodDiaryEntry,
  deleteFoodDiaryEntry,
  listFoodDiaryEntriesForEpisode,
  listFoodDiaryEntriesForUser,
  normalizeFoodDiaryEntryUpdate,
  updateFoodDiaryEntry,
  validateAndNormalizeFoodDiaryCreateCore,
} from './lib/food-diary-data.js';
export type {
  FoodDiaryCreateCorePayload,
  ValidateFoodDiaryCreateCoreResult,
} from './lib/food-diary-data.js';
