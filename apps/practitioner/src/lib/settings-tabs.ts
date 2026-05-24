export const PRACTITIONER_SETTINGS_TAB_IDS = ['account', 'security'] as const;

export type PractitionerSettingsTabId =
  (typeof PRACTITIONER_SETTINGS_TAB_IDS)[number];

/**
 * Parses a practitioner settings tab id from a query string value.
 *
 * @param raw - Raw `tab` search param.
 * @returns A valid tab id, or `account` when missing/invalid.
 */
export function parsePractitionerSettingsTabId(
  raw: string | null,
): PractitionerSettingsTabId {
  if (raw === 'security') {
    return raw;
  }
  return 'account';
}
