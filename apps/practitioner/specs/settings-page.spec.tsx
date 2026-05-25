import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import type { Session } from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { SettingsPage } from '../src/components/settings/SettingsPage';
import { PRACTITIONER_APP_NAV_ITEMS } from '../src/lib/practitioner-nav-items';
import { practitionerSignOutEverywhere } from '../src/lib/practitioner-device-trust';
import { useAuth } from '../src/lib/auth-provider';
import { PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY } from '../src/lib/practitioner-password-sign-in';

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@abstrack/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(),
}));

jest.mock('../src/lib/practitioner-device-trust', () => ({
  practitionerSignOutEverywhere: jest.fn(),
}));

jest.mock('../src/lib/practitioner-sign-out-pending', () => ({
  isPractitionerSignOutTransition: jest.fn(() => false),
}));

const replaceMock = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
}));

const mockedUseAuth = jest.mocked(useAuth);
const mockedGetClient = jest.mocked(getSupabaseBrowserClient);
const mockedSignOutEverywhere = jest.mocked(practitionerSignOutEverywhere);

const USER_ID = '00000000-0000-0000-0000-000000000001';

function ensureDialogElementPolyfill(): void {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ||
    function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ||
    function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
}

function practitionerSession(
  userMetadata: Record<string, unknown> = {},
): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: undefined,
    token_type: 'bearer',
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'practitioner@example.com',
      app_metadata: {},
      user_metadata: userMetadata,
      created_at: '',
    },
  } as Session;
}

function createSupabaseMock(options?: {
  passwordSet?: boolean;
  displayName?: string | null;
}) {
  const updateUserMock = jest.fn().mockResolvedValue({ error: null });
  const getUserMock = jest.fn().mockResolvedValue({
    data: {
      user: {
        id: USER_ID,
        email: 'practitioner@example.com',
        user_metadata: options?.passwordSet
          ? { [PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY]: true }
          : {},
      },
    },
    error: null,
  });
  const listFactorsMock = jest.fn().mockResolvedValue({
    data: { totp: [] },
    error: null,
  });

  const client = {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { display_name: options?.displayName ?? 'Dr Jane Doe' },
            error: null,
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    })),
    auth: {
      getUser: getUserMock,
      updateUser: updateUserMock,
      mfa: {
        listFactors: listFactorsMock,
      },
    },
  };

  return { client, updateUserMock, getUserMock, listFactorsMock };
}

function renderSettingsPage() {
  return render(
    <LiveAnnouncerProvider>
      <SettingsPage />
    </LiveAnnouncerProvider>,
  );
}

describe('PRACTITIONER_APP_NAV_ITEMS', () => {
  it('includes Settings as the last sidebar link targeting /settings', () => {
    const last = PRACTITIONER_APP_NAV_ITEMS.at(-1);
    expect(last).toEqual(
      expect.objectContaining({ href: '/settings', label: 'Settings' }),
    );
    expect(last?.match('/settings')).toBe(true);
    expect(last?.match('/settings/security')).toBe(true);
    expect(last?.match('/patients')).toBe(false);
  });
});

describe('SettingsPage', () => {
  beforeEach(() => {
    ensureDialogElementPolyfill();
    replaceMock.mockClear();
    mockedSignOutEverywhere.mockClear();
    mockSearchParams = new URLSearchParams();
    mockedUseAuth.mockReturnValue({
      session: practitionerSession(),
      loading: false,
      profile: undefined,
      profileError: null,
      accessTokenClaims: null,
      gate: { kind: 'ready' },
    });
    const { client } = createSupabaseMock();
    mockedGetClient.mockReturnValue(
      client as unknown as ReturnType<typeof getSupabaseBrowserClient>,
    );
  });

  it('renders the account tab by default with name, email, and sessions sections', async () => {
    renderSettingsPage();

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(
      screen
        .getByRole('tab', { name: 'Account' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(await screen.findByRole('heading', { name: 'Name' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Email' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
  });

  it('opens the security tab from the tab query string', async () => {
    mockSearchParams = new URLSearchParams('tab=security');
    renderSettingsPage();

    expect(
      screen
        .getByRole('tab', { name: 'Security' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      await screen.findByRole('heading', { name: 'Add a password' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Two-factor authentication (TOTP)',
      }),
    ).toBeTruthy();
  });

  it('updates the URL when the Security tab is selected', async () => {
    renderSettingsPage();
    await screen.findByRole('heading', { name: 'Name' });

    fireEvent.click(screen.getByRole('tab', { name: 'Security' }));
    expect(replaceMock).toHaveBeenCalledWith('/settings?tab=security', {
      scroll: false,
    });
  });

  it('clears the tab query when returning to Account', async () => {
    mockSearchParams = new URLSearchParams('tab=security');
    renderSettingsPage();
    await screen.findByRole('heading', {
      name: 'Two-factor authentication (TOTP)',
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Account' }));
    expect(replaceMock).toHaveBeenCalledWith('/settings', { scroll: false });
  });

  it('requests email change with a callback redirect to the account tab', async () => {
    const { client, updateUserMock } = createSupabaseMock();
    mockedGetClient.mockReturnValue(
      client as unknown as ReturnType<typeof getSupabaseBrowserClient>,
    );

    renderSettingsPage();
    await screen.findByRole('heading', { name: 'Name' });

    fireEvent.change(screen.getByLabelText(/New email/i), {
      target: { value: 'new@example.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Send confirmation email/i }),
    );

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith(
        { email: 'new@example.com' },
        expect.objectContaining({
          emailRedirectTo: expect.stringContaining(
            'next=%2Fsettings%3Ftab%3Daccount',
          ),
        }),
      );
    });
  });

  it('opens a confirmation dialog for sign out everywhere', async () => {
    renderSettingsPage();
    await screen.findByRole('heading', { name: 'Name' });

    fireEvent.click(
      screen.getByRole('button', { name: /Sign out everywhere/i }),
    );

    const dialog = screen.getByRole('dialog', { name: /Sign out everywhere/i });
    expect(
      within(dialog).getByText(/ends your ABStrack session/i),
    ).toBeTruthy();
  });

  it('shows change-password UI when password sign-in is enabled', async () => {
    mockSearchParams = new URLSearchParams('tab=security');
    mockedUseAuth.mockReturnValue({
      session: practitionerSession({
        [PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY]: true,
      }),
      loading: false,
      profile: undefined,
      profileError: null,
      accessTokenClaims: null,
      gate: { kind: 'ready' },
    });
    const { client } = createSupabaseMock({ passwordSet: true });
    mockedGetClient.mockReturnValue(
      client as unknown as ReturnType<typeof getSupabaseBrowserClient>,
    );

    renderSettingsPage();

    expect(
      await screen.findByRole('heading', { name: 'Change password' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Revoke password sign-in/i }),
    ).toBeTruthy();
  });
});
