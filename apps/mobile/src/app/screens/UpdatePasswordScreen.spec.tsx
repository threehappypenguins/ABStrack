import * as React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { AppThemeProvider } from '../theme/AppThemeContext';
import { UpdatePasswordScreen } from './UpdatePasswordScreen';

jest.mock('../../lib/supabase-wiring', () => ({
  getMobileSupabaseClient: jest.fn(),
}));

/** Flush microtasks + next macrotask so AppThemeProvider’s async theme hydration runs inside `act`. */
function flushAsyncThemeHydration(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('UpdatePasswordScreen', () => {
  test('disables submission and shows back to login when recovery link is invalid', async () => {
    const onGoToLogin = jest.fn();

    const { getByLabelText, getByText } = render(
      <AppThemeProvider>
        <UpdatePasswordScreen
          recoveryError="This reset link is invalid or expired. Request a new one."
          onGoToLogin={onGoToLogin}
          onPasswordUpdated={jest.fn()}
        />
      </AppThemeProvider>,
    );

    await act(async () => {
      await flushAsyncThemeHydration();
    });

    const updateButton = getByLabelText('Update password');

    expect(updateButton.props.accessibilityState?.disabled).toBe(true);
    expect(
      getByText('This reset link is invalid or expired. Request a new one.'),
    ).toBeTruthy();

    fireEvent.press(getByLabelText('Back to login'));

    expect(onGoToLogin).toHaveBeenCalledTimes(1);
  });
});
