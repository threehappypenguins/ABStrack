import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import { PractitionerPatientsPage } from '../src/components/practitioner-patients-page';

const listActivePractitionerPatientDirectory = jest.fn();

jest.mock('@abstrack/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(() => ({})),
}));

jest.mock('@abstrack/supabase', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/supabase')>(
      '@abstrack/supabase',
    );
  return {
    ...actual,
    listActivePractitionerPatientDirectory: (...args: unknown[]) =>
      listActivePractitionerPatientDirectory(...args),
  };
});

function renderPatientsPage() {
  return render(
    <LiveAnnouncerProvider>
      <PractitionerPatientsPage />
    </LiveAnnouncerProvider>,
  );
}

describe('PractitionerPatientsPage', () => {
  beforeEach(() => {
    listActivePractitionerPatientDirectory.mockReset();
  });

  it('shows an empty state when there are no active grants', async () => {
    listActivePractitionerPatientDirectory.mockResolvedValue({
      ok: true,
      data: [],
    });

    renderPatientsPage();

    expect(
      await screen.findByRole('heading', { name: 'No patients yet' }),
    ).toBeTruthy();
    expect(screen.getByText(/send an invite from Settings/i)).toBeTruthy();
  });

  it('renders keyboard-reachable patient links', async () => {
    listActivePractitionerPatientDirectory.mockResolvedValue({
      ok: true,
      data: [
        {
          grantId: 'grant-1',
          patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          patientDisplayName: 'Jordan Lee',
          grantedAt: '2026-05-01T10:00:00.000Z',
        },
      ],
    });

    renderPatientsPage();

    const link = await screen.findByRole('link', {
      name: /Jordan Lee, access granted/i,
    });
    expect(link.getAttribute('href')).toBe(
      '/patients/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
  });

  it('shows an error with retry when the directory load fails', async () => {
    listActivePractitionerPatientDirectory.mockResolvedValue({
      ok: false,
      error: {
        code: 'unknown',
        message: 'Something went wrong. Please try again.',
        name: 'PresetDataError',
      },
    });

    renderPatientsPage();

    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeTruthy();

    listActivePractitionerPatientDirectory.mockResolvedValue({
      ok: true,
      data: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'No patients yet' }),
      ).toBeTruthy();
    });
  });
});
