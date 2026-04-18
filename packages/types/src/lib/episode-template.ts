import type {
  HealthMarkerPresetRow,
  IsoTimestamptz,
  SymptomPresetRow,
  Uuid,
} from './types.js';

/**
 * Maximum length for {@link EpisodeTemplateRow.name} in the UI and shared validation.
 * Database column is unbounded `text`; this keeps payloads reasonable and matches product expectations.
 */
export const EPISODE_TEMPLATE_NAME_MAX_LENGTH = 200;

/**
 * Trims whitespace for episode template display names.
 *
 * @param raw - User input.
 * @returns Trimmed string (may be empty).
 */
export function normalizeEpisodeTemplateName(raw: string): string {
  return raw.trim();
}

export type EpisodeTemplateNameValidation =
  | { ok: true; name: string }
  | { ok: false; message: string };

/**
 * Validates a template name after {@link normalizeEpisodeTemplateName}.
 * Use the returned `name` on success for persistence.
 *
 * @param raw - User input (trimmed inside this function).
 * @returns Success with normalized name or a user-facing error message.
 */
export function validateEpisodeTemplateName(
  raw: string,
): EpisodeTemplateNameValidation {
  const name = normalizeEpisodeTemplateName(raw);
  if (!name) {
    return { ok: false, message: 'Enter a name for this episode template.' };
  }
  if (name.length > EPISODE_TEMPLATE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `Use at most ${EPISODE_TEMPLATE_NAME_MAX_LENGTH} characters for the template name.`,
    };
  }
  return { ok: true, name };
}

/**
 * Row from `episode_templates`: one named pairing of symptom + health marker presets (PRD).
 */
export interface EpisodeTemplateRow {
  id: Uuid;
  user_id: Uuid;
  name: string;
  symptom_preset_id: Uuid;
  health_marker_preset_id: Uuid;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type EpisodeTemplateInsert = Pick<
  EpisodeTemplateRow,
  'user_id' | 'name' | 'symptom_preset_id' | 'health_marker_preset_id'
> & {
  id?: string;
};

export type EpisodeTemplateUpdate = Partial<
  Pick<
    EpisodeTemplateRow,
    'name' | 'symptom_preset_id' | 'health_marker_preset_id'
  >
>;

/**
 * Episode template with embedded preset names for list/detail UIs (from Supabase select with joins).
 */
export interface EpisodeTemplateWithPresetsRow extends EpisodeTemplateRow {
  symptom_preset: Pick<SymptomPresetRow, 'id' | 'name'>;
  health_marker_preset: Pick<HealthMarkerPresetRow, 'id' | 'name'>;
}

export type EpisodeTemplatePairValidation =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Ensures both preset ids are present before create/update (shared by web and mobile UIs).
 *
 * @param symptomPresetId - Selected symptom preset id.
 * @param healthMarkerPresetId - Selected health marker preset id.
 */
export function validateEpisodeTemplatePresetPair(
  symptomPresetId: string | undefined | null,
  healthMarkerPresetId: string | undefined | null,
): EpisodeTemplatePairValidation {
  const s = typeof symptomPresetId === 'string' ? symptomPresetId.trim() : '';
  const h =
    typeof healthMarkerPresetId === 'string' ? healthMarkerPresetId.trim() : '';
  if (!s) {
    return { ok: false, message: 'Choose a symptom preset.' };
  }
  if (!h) {
    return { ok: false, message: 'Choose a health marker preset.' };
  }
  return { ok: true };
}
