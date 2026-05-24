import { parsePractitionerSettingsTabId } from './settings-tabs';

describe('settings-tabs', () => {
  it('defaults to account for missing or invalid tab', () => {
    expect(parsePractitionerSettingsTabId(null)).toBe('account');
    expect(parsePractitionerSettingsTabId('invites')).toBe('account');
  });

  it('parses security tab', () => {
    expect(parsePractitionerSettingsTabId('security')).toBe('security');
  });
});
