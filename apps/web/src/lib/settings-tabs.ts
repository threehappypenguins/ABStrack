export const SETTINGS_TAB_IDS = ['account', 'security', 'invites'] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

/**
 * Parses a settings tab id from a query string value.
 *
 * @param raw - Raw `tab` search param.
 * @returns A valid tab id, or `account` when missing/invalid.
 */
export function parseSettingsTabId(raw: string | null): SettingsTabId {
  if (raw === 'security' || raw === 'invites') {
    return raw;
  }
  return 'account';
}
