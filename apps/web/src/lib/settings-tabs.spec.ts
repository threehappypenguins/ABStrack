import { parseSettingsTabId } from './settings-tabs';

describe('parseSettingsTabId', () => {
  it('defaults to account', () => {
    expect(parseSettingsTabId(null)).toBe('account');
    expect(parseSettingsTabId('invalid')).toBe('account');
  });

  it('parses security and invites', () => {
    expect(parseSettingsTabId('security')).toBe('security');
    expect(parseSettingsTabId('invites')).toBe('invites');
  });
});
