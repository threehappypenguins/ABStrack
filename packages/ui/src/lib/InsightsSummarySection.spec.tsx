import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InsightsSummarySection } from './InsightsSummarySection.js';

describe('InsightsSummarySection', () => {
  const dateRange = {
    from: new Date(2026, 2, 1),
    to: new Date(2026, 2, 31),
  };

  it('renders summary cards, callouts, and charts when overview data exists', () => {
    render(
      <InsightsSummarySection
        dateRange={dateRange}
        timeZone="America/New_York"
        summary={{
          total_episode_count: 6,
          abs_episode_count: 2,
          other_episode_count: 4,
          average_episodes_per_week: 1.4,
          longest_episode_free_streak_days: 8,
          current_episode_free_streak_days: 3,
          average_episode_duration_hours: 9.1,
        }}
        weekCounts={[
          {
            week_start: '2026-03-02T05:00:00.000Z',
            episode_type: 'Other',
            episode_count: 1,
          },
          {
            week_start: '2026-03-16T04:00:00.000Z',
            episode_type: 'ABS',
            episode_count: 1,
          },
          {
            week_start: '2026-03-16T04:00:00.000Z',
            episode_type: 'Other',
            episode_count: 3,
          },
        ]}
        symptomFrequencies={[
          { symptom_name: 'Nausea', occurrence_count: 6 },
          { symptom_name: 'Abdominal pain', occurrence_count: 4 },
        ]}
        startHourDistribution={[
          { hour_of_day: 5, episode_type: 'Other', episode_count: 4 },
          { hour_of_day: 6, episode_type: 'Other', episode_count: 1 },
          { hour_of_day: 15, episode_type: 'ABS', episode_count: 2 },
        ]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Overview' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Total episodes')).toBeInTheDocument();
    expect(screen.getByText('Episode calendar')).toBeInTheDocument();
    expect(screen.getByText('Symptom frequency')).toBeInTheDocument();
    expect(screen.getByText('When episodes start')).toBeInTheDocument();
    expect(screen.getAllByText('Pattern callout').length).toBeGreaterThan(0);
    expect(screen.getByText('Nausea')).toBeInTheDocument();
  });

  it('renders the empty state when the selected period has no overview data', () => {
    render(
      <InsightsSummarySection
        dateRange={dateRange}
        timeZone="America/New_York"
        summary={{
          total_episode_count: 0,
          abs_episode_count: 0,
          other_episode_count: 0,
          average_episodes_per_week: 0,
          longest_episode_free_streak_days: 31,
          current_episode_free_streak_days: 31,
          average_episode_duration_hours: null,
        }}
        weekCounts={[]}
        symptomFrequencies={[]}
        startHourDistribution={[]}
      />,
    );

    expect(screen.getByText('No overview yet')).toBeInTheDocument();
    expect(
      screen.getByText('No episode or symptom data in this date range yet.'),
    ).toBeInTheDocument();
  });

  it('formats the selected period label using local calendar dates', () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    function dateTimeFormatMock(
      this: Intl.DateTimeFormat,
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      return new originalDateTimeFormat(locales, options);
    }
    const dateTimeFormatSpy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(dateTimeFormatMock as typeof Intl.DateTimeFormat);

    try {
      render(
        <InsightsSummarySection
          dateRange={dateRange}
          timeZone="Pacific/Auckland"
          summary={{
            total_episode_count: 0,
            abs_episode_count: 0,
            other_episode_count: 0,
            average_episodes_per_week: 0,
            longest_episode_free_streak_days: 31,
            current_episode_free_streak_days: 31,
            average_episode_duration_hours: null,
          }}
          weekCounts={[]}
          symptomFrequencies={[]}
          startHourDistribution={[]}
        />,
      );

      expect(
        dateTimeFormatSpy.mock.calls.some(
          ([, options]) =>
            options?.month === 'short' &&
            options?.day === 'numeric' &&
            options?.timeZone == null,
        ),
      ).toBe(true);
    } finally {
      dateTimeFormatSpy.mockRestore();
    }
  });
});
