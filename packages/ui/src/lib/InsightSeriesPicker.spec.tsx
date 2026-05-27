import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import {
  InsightSeriesPicker,
  type SelectedSeries,
} from './InsightSeriesPicker.js';
import type {
  ChartableManifestRow,
  ChartManifestRow,
} from './InsightSeriesPicker.types.js';
import { createSelectedSeriesFromManifestRow } from './insight-series-picker-utils.js';

const baseManifestFields = {
  observation_count: 5,
  first_observed_at: '2026-01-01T00:00:00Z',
  last_observed_at: '2026-02-01T00:00:00Z',
};

const bloodPressureRow: ChartManifestRow = {
  series_id: 'bp-1',
  series_type: 'health_marker',
  label: 'Blood pressure',
  response_type: 'numeric',
  is_blood_pressure: true,
  unit: 'mmHg',
  ...baseManifestFields,
};

const glucoseRow: ChartableManifestRow = {
  series_id: 'glucose-1',
  series_type: 'health_marker',
  label: 'Blood glucose',
  response_type: 'numeric',
  is_blood_pressure: false,
  unit: 'mmol/L',
  ...baseManifestFields,
};

const bacRow: ChartableManifestRow = {
  series_id: 'bac-1',
  series_type: 'health_marker',
  label: 'BAC',
  response_type: 'numeric',
  is_blood_pressure: false,
  unit: '%',
  ...baseManifestFields,
};

const heartRateRow: ChartableManifestRow = {
  series_id: 'hr-1',
  series_type: 'health_marker',
  label: 'Heart rate',
  response_type: 'numeric',
  is_blood_pressure: false,
  unit: 'bpm',
  ...baseManifestFields,
};

const severityRow: ChartableManifestRow = {
  series_id: 'symptom-1',
  series_type: 'symptom',
  label: 'Brain fog',
  response_type: 'severity',
  is_blood_pressure: false,
  unit: null,
  ...baseManifestFields,
};

const booleanRow: ChartableManifestRow = {
  series_id: 'symptom-2',
  series_type: 'symptom',
  label: 'Vomiting',
  response_type: 'boolean',
  is_blood_pressure: false,
  unit: null,
  ...baseManifestFields,
};

const textNotesRow: ChartManifestRow = {
  series_id: 'health_marker::custom::notes',
  series_type: 'health_marker',
  label: 'Daily notes',
  response_type: 'text',
  is_blood_pressure: false,
  unit: null,
  ...baseManifestFields,
};

const manifest = [
  bloodPressureRow,
  bacRow,
  glucoseRow,
  heartRateRow,
  severityRow,
  booleanRow,
  textNotesRow,
];

function ControlledPicker({
  initial = [] as SelectedSeries[],
  onChangeSpy,
}: {
  initial?: SelectedSeries[];
  onChangeSpy?: (series: SelectedSeries[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <InsightSeriesPicker
      manifest={manifest}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
    />
  );
}

function seriesAt(
  row: ChartableManifestRow,
  slotIndex: number,
): SelectedSeries {
  const series = createSelectedSeriesFromManifestRow(row, slotIndex);
  if (!series) {
    throw new Error(`Expected chartable fixture for ${row.series_id}`);
  }
  return series;
}

describe('InsightSeriesPicker', () => {
  it('auto-selects bp_band and hides the chart-type dropdown for blood pressure', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledPicker onChangeSpy={onChangeSpy} />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );

    expect(
      screen.getByLabelText('Chart type for series 1', { selector: 'select' }),
    ).toBeInTheDocument();
    expect(onChangeSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({
        seriesId: glucoseRow.series_id,
        chartType: 'line',
      }),
    ]);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: bloodPressureRow.series_id },
      },
    );

    expect(screen.getByText(/Series 1: Blood pressure/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Chart type for series 1', {
        selector: 'select',
      }),
    ).not.toBeInTheDocument();
    expect(onChangeSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({
        seriesId: bloodPressureRow.series_id,
        chartType: 'bp_band',
        isBloodPressure: true,
      }),
    ]);
  });

  it('omits series that would introduce a third distinct value unit from later slots', () => {
    render(
      <ControlledPicker
        initial={[seriesAt(bacRow, 0), seriesAt(glucoseRow, 1)]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    const slotThree = screen.getByLabelText('Data series 3', {
      selector: 'select',
    });

    expect(
      within(slotThree).queryByRole('option', { name: /Heart rate/i }),
    ).not.toBeInTheDocument();
    expect(
      within(slotThree).queryByRole('option', { name: /Brain fog/i }),
    ).not.toBeInTheDocument();
    expect(
      within(slotThree).getByRole('option', { name: /Vomiting/i }),
    ).toBeInTheDocument();
    expect(
      within(slotThree).getByRole('option', { name: /Blood pressure/i }),
    ).toBeInTheDocument();
  });

  it('shows observation counts and observed date range in series options', () => {
    render(<ControlledPicker />);

    const option = within(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
    ).getByRole('option', {
      name: /Blood glucose/i,
    });

    expect(option.textContent).toContain('Blood glucose (mmol/L)');
    expect(option.textContent).toContain('5 obs');
    expect(option.textContent).toContain('to');
  });

  it('formats observed date ranges in the provided timezone', () => {
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
    const timezoneManifest = [
      {
        ...glucoseRow,
        first_observed_at: '2026-01-01T23:30:00Z',
        last_observed_at: '2026-02-01T00:30:00Z',
      },
    ] satisfies ChartManifestRow[];

    try {
      render(
        <InsightSeriesPicker
          manifest={timezoneManifest}
          value={[]}
          onChange={vi.fn()}
          timeZone="Pacific/Auckland"
        />,
      );

      const option = within(
        screen.getByLabelText('Data series 1', { selector: 'select' }),
      ).getByRole('option', {
        name: /Blood glucose/i,
      });

      const startLabel = new originalDateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'Pacific/Auckland',
      }).format(new Date('2026-01-01T23:30:00Z'));
      const endLabel = new originalDateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'Pacific/Auckland',
      }).format(new Date('2026-02-01T00:30:00Z'));

      expect(option.textContent).toContain(`${startLabel} to ${endLabel}`);
      expect(
        dateTimeFormatSpy.mock.calls.some(
          ([, options]) =>
            options?.timeZone === 'Pacific/Auckland' &&
            options?.month === 'short' &&
            options?.day === 'numeric',
        ),
      ).toBe(true);
    } finally {
      dateTimeFormatSpy.mockRestore();
    }
  });

  it('hides extra slots when the parent clears value externally', () => {
    function ExternalResetPicker() {
      const [value, setValue] = useState<SelectedSeries[]>([]);
      return (
        <>
          <button type="button" onClick={() => setValue([])}>
            Reset selection
          </button>
          <InsightSeriesPicker
            manifest={manifest}
            value={value}
            onChange={setValue}
          />
        </>
      );
    }

    render(<ExternalResetPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));
    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Reset selection' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(1);
  });

  it('shows only slot 1 until Add another series reveals slot 2', () => {
    render(<ControlledPicker />);

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(1);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(2);
  });

  it('constrains chart-type options by response_type', () => {
    render(<ControlledPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );

    const chartTypeSelect = screen.getByLabelText('Chart type for series 1', {
      selector: 'select',
    });
    const options = within(chartTypeSelect)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toEqual(['Line', 'Bar', 'Scatter']);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: severityRow.series_id },
      },
    );

    const severityOptions = within(
      screen.getByLabelText('Chart type for series 1', { selector: 'select' }),
    )
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(severityOptions).toEqual(['Line', 'Bar']);
  });

  it('auto-selects event and hides chart-type for boolean series', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledPicker onChangeSpy={onChangeSpy} />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: booleanRow.series_id },
      },
    );

    expect(
      screen.queryByLabelText('Chart type for series 1', {
        selector: 'select',
      }),
    ).not.toBeInTheDocument();
    expect(onChangeSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({
        seriesId: booleanRow.series_id,
        chartType: 'event',
        responseType: 'boolean',
      }),
    ]);
  });

  it('clears slot 1 on remove but keeps the slot visible', () => {
    render(<ControlledPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear series 1' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(1);
    expect(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
    ).toHaveValue('');
  });

  it('preserves later slots when an earlier slot series changes', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledPicker onChangeSpy={onChangeSpy} />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      { target: { value: glucoseRow.series_id } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));
    fireEvent.change(
      screen.getByLabelText('Data series 2', { selector: 'select' }),
      { target: { value: severityRow.series_id } },
    );

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      { target: { value: bloodPressureRow.series_id } },
    );

    expect(onChangeSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({
        seriesId: bloodPressureRow.series_id,
        chartType: 'bp_band',
      }),
      expect.objectContaining({ seriesId: severityRow.series_id }),
    ]);
    expect(
      screen.getByLabelText('Data series 2', { selector: 'select' }),
    ).toHaveValue(severityRow.series_id);
  });

  it('removes later slots when an earlier slot is cleared', () => {
    render(<ControlledPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    fireEvent.change(
      screen.getByLabelText('Data series 2', { selector: 'select' }),
      {
        target: { value: severityRow.series_id },
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear series 1' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Add another series' }),
    ).not.toBeInTheDocument();
  });

  it('reveals slot 3 with one Add after clearing it via the empty series option', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledPicker onChangeSpy={onChangeSpy} />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      { target: { value: glucoseRow.series_id } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));
    fireEvent.change(
      screen.getByLabelText('Data series 2', { selector: 'select' }),
      { target: { value: severityRow.series_id } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));
    fireEvent.change(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
      { target: { value: booleanRow.series_id } },
    );

    fireEvent.change(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
      {
        target: { value: '' },
      },
    );

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(2);
    expect(onChangeSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({ seriesId: glucoseRow.series_id }),
      expect.objectContaining({ seriesId: severityRow.series_id }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(3);
    expect(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
    ).toHaveValue('');

    fireEvent.change(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
      {
        target: { value: booleanRow.series_id },
      },
    );

    expect(onChangeSpy).toHaveBeenLastCalledWith([
      expect.objectContaining({ seriesId: glucoseRow.series_id }),
      expect.objectContaining({ seriesId: severityRow.series_id }),
      expect.objectContaining({
        seriesId: booleanRow.series_id,
        chartType: 'event',
      }),
    ]);
  });

  it('reveals slot 3 with one Add after removing it via Remove series 3', () => {
    render(<ControlledPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      { target: { value: glucoseRow.series_id } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));
    fireEvent.change(
      screen.getByLabelText('Data series 2', { selector: 'select' }),
      { target: { value: severityRow.series_id } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));
    fireEvent.change(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
      { target: { value: booleanRow.series_id } },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove series 3' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(3);
    expect(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
    ).toHaveValue('');
  });

  it('enforces a maximum of three series', () => {
    render(<ControlledPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    fireEvent.change(
      screen.getByLabelText('Data series 2', { selector: 'select' }),
      {
        target: { value: severityRow.series_id },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add another series' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(3);

    fireEvent.change(
      screen.getByLabelText('Data series 3', { selector: 'select' }),
      {
        target: { value: booleanRow.series_id },
      },
    );

    expect(
      screen.queryByRole('button', { name: 'Add another series' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(3);
  });

  it('omits non-chartable text manifest rows from the series selector', () => {
    render(<ControlledPicker />);

    const options = within(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
    ).getAllByRole('option');

    expect(options.map((option) => option.textContent)).not.toContain(
      'Daily notes',
    );
    expect(
      options.some((option) => option.textContent?.includes('Daily notes')),
    ).toBe(false);
  });

  it('calls onChange on mount when the controlled value exceeds three series', () => {
    const onChange = vi.fn();
    const oversizedValue: SelectedSeries[] = [
      seriesAt(glucoseRow, 0),
      seriesAt(severityRow, 1),
      seriesAt(booleanRow, 2),
      { ...seriesAt(glucoseRow, 0), seriesId: 'orphan-4', label: 'Orphan' },
    ];

    render(
      <InsightSeriesPicker
        manifest={manifest}
        value={oversizedValue}
        onChange={onChange}
      />,
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const clamped = onChange.mock.calls[0]?.[0] as SelectedSeries[];
    expect(clamped).toHaveLength(3);
    expect(clamped.map((series) => series.seriesId)).toEqual([
      glucoseRow.series_id,
      severityRow.series_id,
      booleanRow.series_id,
    ]);
  });

  it('clamps onChange to three series when chart type changes with an oversized value', () => {
    const onChange = vi.fn();
    const oversizedValue: SelectedSeries[] = [
      seriesAt(glucoseRow, 0),
      seriesAt(severityRow, 1),
      seriesAt(booleanRow, 2),
      { ...seriesAt(glucoseRow, 0), seriesId: 'orphan-4', label: 'Orphan' },
    ];

    render(
      <InsightSeriesPicker
        manifest={manifest}
        value={oversizedValue}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Chart type for series 1', { selector: 'select' }),
      { target: { value: 'bar' } },
    );

    const lastCall = onChange.mock.calls.at(-1)?.[0] as SelectedSeries[];
    expect(lastCall).toHaveLength(3);
    expect(lastCall[0]).toMatchObject({
      seriesId: glucoseRow.series_id,
      chartType: 'bar',
    });
    expect(lastCall.some((series) => series.seriesId === 'orphan-4')).toBe(
      false,
    );
  });

  it('assigns palette colors by slot index', () => {
    const onChange = vi.fn();
    render(
      <InsightSeriesPicker
        manifest={manifest}
        value={[]}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        seriesId: glucoseRow.series_id,
        chartType: 'line',
        color: '#1d4ed8',
      }),
    ]);
  });
});
