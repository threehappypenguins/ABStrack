import { mergeButtonAccessibilityState } from './mergeButtonAccessibilityState.js';

describe('mergeButtonAccessibilityState', () => {
  it('preserves consumer flags and sets disabled from the disabled prop', () => {
    expect(
      mergeButtonAccessibilityState({ expanded: true, selected: true }, false),
    ).toEqual({
      expanded: true,
      selected: true,
      disabled: false,
    });
  });

  it('forces disabled from the disabled prop over accessibilityState.disabled', () => {
    expect(
      mergeButtonAccessibilityState({ expanded: true, disabled: false }, true),
    ).toEqual({
      expanded: true,
      disabled: true,
    });
  });

  it('treats undefined accessibilityState as an empty merge base', () => {
    expect(mergeButtonAccessibilityState(undefined, undefined)).toEqual({
      disabled: false,
    });
  });
});
