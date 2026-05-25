import {
  clearPractitionerSignOutPending,
  isPractitionerSignOutPending,
  isPractitionerSignOutTransition,
  markPractitionerSignOutPending,
} from './practitioner-sign-out-pending';

describe('practitioner sign-out pending', () => {
  beforeEach(() => {
    clearPractitionerSignOutPending();
  });

  it('marks, detects, and clears the pending flag', () => {
    expect(isPractitionerSignOutPending()).toBe(false);
    markPractitionerSignOutPending();
    expect(isPractitionerSignOutPending()).toBe(true);
    clearPractitionerSignOutPending();
    expect(isPractitionerSignOutPending()).toBe(false);
  });

  it('treats missing session with pending flag as a sign-out transition', () => {
    markPractitionerSignOutPending();
    expect(isPractitionerSignOutTransition(null)).toBe(true);
    expect(isPractitionerSignOutTransition({ user: { id: 'user-1' } })).toBe(
      false,
    );
  });
});
