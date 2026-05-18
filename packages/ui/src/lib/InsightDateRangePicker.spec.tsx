import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveAnnouncerProvider } from './a11y/LiveAnnouncer.js';
import { InsightDateRangePicker } from './InsightDateRangePicker.js';
import type { InsightDateRange } from './insight-date-range-picker-utils.js';

const ANCHOR = new Date(2026, 4, 18, 12, 0, 0);

function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

function ControlledPicker({
  initial,
  onChangeSpy,
}: {
  initial: InsightDateRange;
  onChangeSpy?: (range: InsightDateRange) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <InsightDateRangePicker
      value={value}
      onChange={(range) => {
        setValue(range);
        onChangeSpy?.(range);
      }}
    />
  );
}

function renderWithAnnouncer(ui: ReactElement) {
  return render(<LiveAnnouncerProvider>{ui}</LiveAnnouncerProvider>);
}

describe('InsightDateRangePicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies preset ranges immediately via onChange', () => {
    const onChangeSpy = vi.fn();
    renderWithAnnouncer(
      <ControlledPicker
        initial={{
          from: localDate(2026, 0, 1),
          to: localDate(2026, 0, 7),
        }}
        onChangeSpy={onChangeSpy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    expect(onChangeSpy).toHaveBeenCalledWith({
      from: localDate(2026, 4, 12),
      to: localDate(2026, 4, 18),
    });
  });

  it('navigates the calendar to the range end month when a preset is selected', () => {
    renderWithAnnouncer(
      <ControlledPicker
        initial={{
          from: localDate(2026, 0, 1),
          to: localDate(2026, 0, 7),
        }}
      />,
    );

    expect(screen.getByText('January 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    expect(screen.getByText('May 2026')).toBeInTheDocument();
  });

  it('commits a new range after a partial calendar selection followed by an end day', () => {
    const onChangeSpy = vi.fn();
    renderWithAnnouncer(
      <ControlledPicker
        initial={{
          from: localDate(2026, 4, 12),
          to: localDate(2026, 4, 18),
        }}
        onChangeSpy={onChangeSpy}
      />,
    );

    const calendar = screen.getByRole('grid', { name: 'May 2026' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Tuesday, May 5th, 2026' }),
    );
    expect(onChangeSpy).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Friday, May 8th, 2026' }),
    );
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenCalledWith({
      from: localDate(2026, 4, 5),
      to: localDate(2026, 4, 8),
    });
    expect(calendar).toBeInTheDocument();
  });

  it('announces the selected range to screen readers when a preset changes', () => {
    renderWithAnnouncer(
      <ControlledPicker
        initial={{
          from: localDate(2026, 0, 1),
          to: localDate(2026, 0, 7),
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));

    expect(screen.getByText(/Date range selected:/)).toBeInTheDocument();
  });
});
