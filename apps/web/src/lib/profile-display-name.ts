export type ProfileNameFields = {
  firstName: string;
  lastName: string;
};

/**
 * Splits `profiles.display_name` into first and last name fields for settings forms.
 * Uses the first whitespace-delimited token as the first name and the remainder as last name.
 *
 * @param displayName - Stored profile display name.
 * @returns Editable first/last name fields.
 */
export function splitDisplayNameIntoNameFields(
  displayName: string | null | undefined,
): ProfileNameFields {
  const trimmed = displayName?.trim() ?? '';
  if (trimmed === '') {
    return { firstName: '', lastName: '' };
  }
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

/**
 * Combines first and last name fields into the single `profiles.display_name` value.
 *
 * @param fields - Form first/last name values.
 * @returns Trimmed display name, or `null` when both fields are empty.
 */
export function combineNameFieldsIntoDisplayName(
  fields: ProfileNameFields,
): string | null {
  const firstName = fields.firstName.trim();
  const lastName = fields.lastName.trim();
  const combined = [firstName, lastName].filter(Boolean).join(' ');
  return combined === '' ? null : combined;
}
