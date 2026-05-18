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
  glucoseRow,
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

  it('clamps onChange to three series when chart type changes with an oversized value', () => {
    const onChange = vi.fn();
    const seriesAt = (row: ChartableManifestRow, slotIndex: number) => {
      const series = createSelectedSeriesFromManifestRow(row, slotIndex);
      if (!series) {
        throw new Error(`Expected chartable fixture for ${row.series_id}`);
      }
      return series;
    };
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
