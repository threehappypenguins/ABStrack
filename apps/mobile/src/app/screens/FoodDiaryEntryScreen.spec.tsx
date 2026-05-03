import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme, useRoute } from '@react-navigation/native';
import { createFoodDiaryEntry } from '@abstrack/supabase';
import { announce } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { FoodDiaryEntryScreen } from './FoodDiaryEntryScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: jest.fn(),
}));

jest.mock('@abstrack/supabase', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/supabase')>(
      '@abstrack/supabase',
    );
  return {
    ...actual,
    createFoodDiaryEntry: jest.fn(),
  };
});

const mockGetUser = jest.fn();

jest.mock('../../lib/supabase-wiring-core', () => {
  const actual = jest.requireActual(
    '../../lib/supabase-wiring-core',
  ) as typeof import('../../lib/supabase-wiring-core');
  return {
    ...actual,
    getMobileSupabaseClient: jest.fn(() => ({
      mockClient: true,
      auth: {
        getUser: mockGetUser,
      },
    })),
  };
});

jest.mock('../theme/AppThemeContext', () => ({
  useAppTheme: jest.fn(),
}));

jest.mock('@abstrack/ui/native', () => {
  const actual = jest.requireActual('@abstrack/ui/native');
  return {
    ...actual,
    announce: jest.fn(async () => undefined),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props: {
    mode: 'date' | 'time';
    onChange: (...args: unknown[]) => void;
  }) {
    return (
      <View
        testID={props.mode === 'date' ? 'mock-date-picker' : 'mock-time-picker'}
        onChange={props.onChange}
      />
    );
  };
});

describe('FoodDiaryEntryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useRoute).mockReturnValue({
      key: 'FoodDiaryEntry',
      name: 'FoodDiaryEntry',
      params: { episodeId: 'episode-1' },
    } as never);

    jest.mocked(useAppTheme).mockReturnValue({
      colorScheme: 'light',
      colors: lightAppColors,
      themePreference: 'system',
      setThemePreference: jest.fn(async () => undefined),
      navigationTheme: DefaultTheme,
      statusBarStyle: 'dark',
    });

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-1' } },
    });

    jest.mocked(createFoodDiaryEntry).mockResolvedValue({
      ok: true,
      data: {
        id: 'food-1',
        user_id: 'test-user-1',
        episode_id: 'episode-1',
        meal_tag: 'Breakfast',
        food_note: 'Toast',
        logged_at: '2026-04-22T15:45:00.000Z',
        created_at: '2026-04-22T15:45:00.000Z',
        updated_at: '2026-04-22T15:45:00.000Z',
      },
    });
  });

  test('unauthenticated save shows auth error and does not create entry', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
    });
    const screen = render(<FoodDiaryEntryScreen />);

    fireEvent.press(screen.getByLabelText('Save food entry'));

    await waitFor(() => {
      expect(
        screen.getByText('You must be signed in to save a food diary entry.'),
      ).toBeTruthy();
    });
    expect(createFoodDiaryEntry).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith(
      'You must be signed in to save a food diary entry.',
      { politeness: 'assertive' },
    );
  });

  test('meal tag validation blocks save when no tag selected', async () => {
    const screen = render(<FoodDiaryEntryScreen />);

    fireEvent.press(screen.getByLabelText('Save food entry'));

    await waitFor(() => {
      expect(screen.getByText('Choose a meal tag.')).toBeTruthy();
    });
    expect(createFoodDiaryEntry).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith('Choose a meal tag.', {
      politeness: 'assertive',
    });
  });

  test('successful save uses picker-updated date/time and resets form', async () => {
    const screen = render(<FoodDiaryEntryScreen />);

    fireEvent.press(screen.getByLabelText('Breakfast'));
    fireEvent.changeText(screen.getByLabelText('Food note'), 'Toast');

    fireEvent.press(screen.getByLabelText('Logged date'));
    fireEvent(
      screen.getByTestId('mock-date-picker'),
      'onChange',
      { type: 'set' },
      new Date('2026-04-10T00:00:00'),
    );

    fireEvent.press(screen.getByLabelText('Logged time'));
    fireEvent(
      screen.getByTestId('mock-time-picker'),
      'onChange',
      { type: 'set' },
      new Date('2026-04-10T15:45:00'),
    );

    fireEvent.press(screen.getByLabelText('Save food entry'));

    await waitFor(() => {
      expect(createFoodDiaryEntry).toHaveBeenCalledTimes(1);
    });
    expect(createFoodDiaryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        user_id: 'test-user-1',
        episode_id: 'episode-1',
        meal_tag: 'Breakfast',
        food_note: 'Toast',
        logged_at: new Date('2026-04-10T15:45').toISOString(),
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText('Food entry saved and linked to this episode.'),
      ).toBeTruthy();
    });
    expect(screen.getByLabelText('Food note').props.value).toBe('');
    expect(announce).toHaveBeenCalledWith('Food entry saved.', {
      politeness: 'polite',
    });
  });

  test('standalone save collapses form and add new entry restores fresh form', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'FoodDiaryEntry',
      name: 'FoodDiaryEntry',
      params: {},
    } as never);

    jest.mocked(createFoodDiaryEntry).mockResolvedValue({
      ok: true,
      data: {
        id: 'food-standalone-1',
        user_id: 'test-user-1',
        episode_id: null,
        meal_tag: 'Lunch',
        food_note: 'Salad',
        logged_at: '2026-04-22T12:00:00.000Z',
        created_at: '2026-04-22T12:00:00.000Z',
        updated_at: '2026-04-22T12:00:00.000Z',
      },
    });

    const screen = render(<FoodDiaryEntryScreen />);

    fireEvent.press(screen.getByLabelText('Lunch'));
    fireEvent.changeText(screen.getByLabelText('Food note'), 'Salad');
    fireEvent.press(screen.getByLabelText('Save food entry'));

    await waitFor(() => {
      expect(createFoodDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({ mockClient: true }),
        expect.objectContaining({
          user_id: 'test-user-1',
          episode_id: null,
          meal_tag: 'Lunch',
          food_note: 'Salad',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Food entry saved.')).toBeTruthy();
    });
    expect(screen.queryByText('Meal tag')).toBeNull();

    fireEvent.press(screen.getByLabelText('Add a new food diary entry'));

    await waitFor(() => {
      expect(screen.getByText('Meal tag')).toBeTruthy();
    });
    expect(screen.getByLabelText('Food note').props.value).toBe('');
    expect(announce).toHaveBeenCalledWith(
      'Ready to add another food diary entry.',
      { politeness: 'polite' },
    );
  });
});
