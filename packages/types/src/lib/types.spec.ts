import { describe, expect, it } from 'vitest';
import {
  ACCESS_LOG_ACTOR_ROLES,
  APP_ROLES,
  EPISODE_TYPES,
  HEALTH_MARKER_KINDS,
  MEDIA_TYPES,
  MEAL_TAGS,
  PRESET_HEALTH_MARKER_KINDS,
  SYMPTOM_RESPONSE_TYPES,
  isAccessLogActorRole,
  isAppRole,
  isEpisodeType,
  isHealthMarkerKind,
  isMealTag,
  isMediaType,
  isPresetHealthMarkerKind,
  isSymptomResponseType,
} from './types.js';

/** Schema CHECK lists — keep in sync with 20260327120000_abstrack_core_schema.sql */
const SCHEMA_APP_ROLES = ['patient', 'caretaker', 'practitioner'] as const;
const SCHEMA_EPISODE_TYPES = ['ABS', 'Other'] as const;
const SCHEMA_MEAL_TAGS = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Other',
] as const;
const SCHEMA_SYMPTOM_RESPONSE = [
  'yes_no',
  'severity_scale',
  'free_text',
  'photo',
  'video',
] as const;
const SCHEMA_PRESET_MARKER_KINDS = [
  'bac',
  'blood_glucose',
  'blood_pressure',
  'heart_rate',
  'weight',
  'custom',
] as const;
const SCHEMA_HEALTH_MARKER_KINDS = [
  ...SCHEMA_PRESET_MARKER_KINDS,
  'wellness_mood',
] as const;
const SCHEMA_ACCESS_ACTOR_ROLES = [
  'patient',
  'caretaker',
  'practitioner',
  'system',
  'service',
] as const;
const SCHEMA_MEDIA_TYPES = ['photo', 'video'] as const;

function expectSameStringSet(
  exported: readonly string[],
  schema: readonly string[],
): void {
  expect(new Set(exported)).toEqual(new Set(schema));
  expect(exported.length).toBe(schema.length);
}

describe('domain vocabulary (schema alignment)', () => {
  it('APP_ROLES matches profiles.app_role CHECK', () => {
    expectSameStringSet(APP_ROLES, SCHEMA_APP_ROLES);
  });

  it('EPISODE_TYPES matches episodes.episode_type CHECK', () => {
    expectSameStringSet(EPISODE_TYPES, SCHEMA_EPISODE_TYPES);
  });

  it('MEAL_TAGS matches food_diary_entries.meal_tag CHECK', () => {
    expectSameStringSet(MEAL_TAGS, SCHEMA_MEAL_TAGS);
  });

  it('SYMPTOM_RESPONSE_TYPES matches preset_symptoms / episode_symptoms CHECK', () => {
    expectSameStringSet(SYMPTOM_RESPONSE_TYPES, SCHEMA_SYMPTOM_RESPONSE);
  });

  it('PRESET_HEALTH_MARKER_KINDS matches preset_health_markers.marker_kind CHECK', () => {
    expectSameStringSet(PRESET_HEALTH_MARKER_KINDS, SCHEMA_PRESET_MARKER_KINDS);
  });

  it('HEALTH_MARKER_KINDS matches health_markers.marker_kind CHECK', () => {
    expectSameStringSet(HEALTH_MARKER_KINDS, SCHEMA_HEALTH_MARKER_KINDS);
  });

  it('ACCESS_LOG_ACTOR_ROLES matches access_log.actor_role CHECK', () => {
    expectSameStringSet(ACCESS_LOG_ACTOR_ROLES, SCHEMA_ACCESS_ACTOR_ROLES);
  });

  it('MEDIA_TYPES matches episode_media.media_type CHECK', () => {
    expectSameStringSet(MEDIA_TYPES, SCHEMA_MEDIA_TYPES);
  });
});

describe('type guards', () => {
  it('isAppRole', () => {
    expect(isAppRole('patient')).toBe(true);
    expect(isAppRole('system')).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });

  it('isEpisodeType', () => {
    expect(isEpisodeType('ABS')).toBe(true);
    expect(isEpisodeType('abs')).toBe(false);
  });

  it('isMealTag', () => {
    expect(isMealTag('Breakfast')).toBe(true);
    expect(isMealTag('breakfast')).toBe(false);
  });

  it('isSymptomResponseType', () => {
    expect(isSymptomResponseType('severity_scale')).toBe(true);
    expect(isSymptomResponseType('scale')).toBe(false);
  });

  it('isPresetHealthMarkerKind', () => {
    expect(isPresetHealthMarkerKind('bac')).toBe(true);
    expect(isPresetHealthMarkerKind('wellness_mood')).toBe(false);
  });

  it('isHealthMarkerKind', () => {
    expect(isHealthMarkerKind('wellness_mood')).toBe(true);
    expect(isHealthMarkerKind('unknown')).toBe(false);
  });

  it('isMediaType', () => {
    expect(isMediaType('photo')).toBe(true);
    expect(isMediaType('audio')).toBe(false);
  });

  it('isAccessLogActorRole', () => {
    expect(isAccessLogActorRole('service')).toBe(true);
    expect(isAccessLogActorRole('admin')).toBe(false);
  });
});
