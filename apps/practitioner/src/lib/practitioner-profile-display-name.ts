/** `auth.users` metadata: professional title or honorific (for example Dr, Prof). */
export const PRACTITIONER_TITLE_USER_METADATA_KEY =
  'abstrack_practitioner_title';

type UserMetadataCarrier = {
  user_metadata?: Record<string, unknown> | null;
};

export type PractitionerProfileNameFields = {
  title: string;
  firstName: string;
  lastName: string;
};

/**
 * Reads the practitioner title from Auth user metadata.
 *
 * @param user - Supabase Auth user (session or `getUser()`).
 * @returns Trimmed title, or an empty string when unset.
 */
export function readPractitionerTitleFromUserMetadata(
  user: UserMetadataCarrier | null | undefined,
): string {
  const raw = user?.user_metadata?.[PRACTITIONER_TITLE_USER_METADATA_KEY];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Splits `profiles.display_name` into title, first, and last name fields for settings forms.
 * Uses stored title metadata when present; otherwise treats the full display name as first/last only.
 *
 * @param displayName - Stored profile display name.
 * @param titleFromMetadata - Title from {@link readPractitionerTitleFromUserMetadata}.
 * @returns Editable title and name fields.
 */
export function splitDisplayNameIntoPractitionerNameFields(
  displayName: string | null | undefined,
  titleFromMetadata: string | null | undefined,
): PractitionerProfileNameFields {
  const storedTitle = titleFromMetadata?.trim() ?? '';
  const trimmed = displayName?.trim() ?? '';

  if (trimmed === '') {
    return { title: storedTitle, firstName: '', lastName: '' };
  }

  if (storedTitle !== '') {
    let remainder = trimmed;
    const lowerDisplay = trimmed.toLowerCase();
    const lowerTitle = storedTitle.toLowerCase();
    if (lowerDisplay.startsWith(`${lowerTitle} `)) {
      remainder = trimmed.slice(storedTitle.length).trimStart();
    } else if (lowerDisplay === lowerTitle) {
      remainder = '';
    }
    const parts = remainder.split(/\s+/).filter(Boolean);
    const firstName = parts[0] ?? '';
    const lastName = parts.slice(1).join(' ');
    return { title: storedTitle, firstName, lastName };
  }

  const parts = trimmed.split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  return { title: '', firstName, lastName };
}

/**
 * Combines title and name fields into the single `profiles.display_name` value shown to patients.
 *
 * @param fields - Form title and name values.
 * @returns Trimmed display name, or `null` when all fields are empty.
 */
export function combinePractitionerNameFieldsIntoDisplayName(
  fields: PractitionerProfileNameFields,
): string | null {
  const title = fields.title.trim();
  const firstName = fields.firstName.trim();
  const lastName = fields.lastName.trim();
  const combined = [title, firstName, lastName].filter(Boolean).join(' ');
  return combined === '' ? null : combined;
}
