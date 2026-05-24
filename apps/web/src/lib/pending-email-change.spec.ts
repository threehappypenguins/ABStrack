import { readPendingEmailChange } from './pending-email-change';

describe('readPendingEmailChange', () => {
  it('returns null for missing or empty new_email', () => {
    expect(readPendingEmailChange(null)).toBeNull();
    expect(readPendingEmailChange({})).toBeNull();
    expect(readPendingEmailChange({ new_email: '' })).toBeNull();
    expect(readPendingEmailChange({ new_email: '   ' })).toBeNull();
  });

  it('returns normalized pending address from GoTrue user', () => {
    expect(readPendingEmailChange({ new_email: '  New@Example.com  ' })).toBe(
      'new@example.com',
    );
  });
});
