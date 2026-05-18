import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import {
  InsightSeriesPicker,
  type ChartManifestRow,
  type SelectedSeries,
} from './InsightSeriesPicker.js';

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

const glucoseRow: ChartManifestRow = {
  series_id: 'glucose-1',
  series_type: 'health_marker',
  label: 'Blood glucose',
  response_type: 'numeric',
  is_blood_pressure: false,
  unit: 'mmol/L',
  ...baseManifestFields,
};

const severityRow: ChartManifestRow = {
  series_id: 'symptom-1',
  series_type: 'symptom',
  label: 'Brain fog',
  response_type: 'severity',
  is_blood_pressure: false,
  ...baseManifestFields,
};

const booleanRow: ChartManifestRow = {
  series_id: 'symptom-2',
  series_type: 'symptom',
  label: 'Vomiting',
  response_type: 'boolean',
  is_blood_pressure: false,
  ...baseManifestFields,
};

const manifest = [bloodPressureRow, glucoseRow, severityRow, booleanRow];

function ControlledPicker({
  initial = [] as SelectedSeries[],
}: {
  initial?: SelectedSeries[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <InsightSeriesPicker
      manifest={manifest}
      value={value}
      onChange={setValue}
    />
  );
}

describe('InsightSeriesPicker', () => {
  it('auto-selects bp_band and hides the chart-type dropdown for blood pressure', () => {
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
        target: { value: bloodPressureRow.series_id },
      },
    );

    expect(
      screen.queryByLabelText('Chart type for series 1', {
        selector: 'select',
      }),
    ).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        seriesId: bloodPressureRow.series_id,
        chartType: 'bp_band',
        isBloodPressure: true,
        color: '#1d4ed8',
      }),
    ]);
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
    render(<ControlledPicker />);

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
  });

  it('clears slot 1 on remove but keeps the slot visible', () => {
    render(<ControlledPicker />);

    fireEvent.change(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
      {
        target: { value: glucoseRow.series_id },
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove series 1' }));

    expect(
      screen.getAllByLabelText(/Data series \d/, { selector: 'select' }),
    ).toHaveLength(1);
    expect(
      screen.getByLabelText('Data series 1', { selector: 'select' }),
    ).toHaveValue('');
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

    fireEvent.click(screen.getByRole('button', { name: 'Remove series 1' }));

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
