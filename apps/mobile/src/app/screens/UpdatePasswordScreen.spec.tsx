import * as React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { AppThemeProvider } from '../theme/AppThemeContext';
import { UpdatePasswordScreen } from './UpdatePasswordScreen';

jest.mock('../../lib/supabase-wiring', () => ({
  getMobileSupabaseClient: jest.fn(),
}));

describe('UpdatePasswordScreen', () => {
  test('disables submission and shows back to login when recovery link is invalid', () => {
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

    const updateButton = getByLabelText('Update password');

    expect(updateButton.props.accessibilityState?.disabled).toBe(true);
    expect(
      getByText('This reset link is invalid or expired. Request a new one.'),
    ).toBeTruthy();

    fireEvent.press(getByLabelText('Back to login'));

    expect(onGoToLogin).toHaveBeenCalledTimes(1);
  });
});
