'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SettingsSecuritySection } from '@/components/settings/SettingsSecuritySection';
import { useAuth } from '@/lib/auth-provider';
import { practitionerSignOutEverywhere } from '@/lib/practitioner-device-trust';
import { isPractitionerSignOutTransition } from '@/lib/practitioner-sign-out-pending';
import {
  PRACTITIONER_TITLE_USER_METADATA_KEY,
  combinePractitionerNameFieldsIntoDisplayName,
  readPractitionerTitleFromUserMetadata,
  splitDisplayNameIntoPractitionerNameFields,
} from '@/lib/practitioner-profile-display-name';
import { readPendingEmailChange } from '@/lib/pending-email-change';
import {
  PRACTITIONER_SETTINGS_TAB_IDS,
  type PractitionerSettingsTabId,
  parsePractitionerSettingsTabId,
} from '@/lib/settings-tabs';

const SETTINGS_SURFACE_CLASS =
  'rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8';

const TAB_ORDER = PRACTITIONER_SETTINGS_TAB_IDS;

/** How long the name-save confirmation stays visible before reverting. */
const NAME_SAVE_FEEDBACK_MS = 3_000;

function tabClass(active: boolean): string {
  return active
    ? 'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-app-tab-active-bg px-4 py-2 text-sm font-semibold text-app-tab-active-text shadow-sm ring-1 ring-app-tab-active-ring/25'
    : 'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-app-muted transition hover:bg-[var(--app-nav-hover-bg)] hover:text-app-ink';
}

/**
 * Account and security settings for the practitioner web app.
 *
 * @returns Settings hub with tabbed sections.
 */
export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formId = useId();
  const { announce } = useAnnounce();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { session, loading: authLoading } = useAuth();

  const tabFromUrl = parsePractitionerSettingsTabId(searchParams.get('tab'));
  const [activeTab, setActiveTab] =
    useState<PractitionerSettingsTabId>(tabFromUrl);
  const [signOutEverywhereOpen, setSignOutEverywhereOpen] = useState(false);
  const [securitySectionMounted, setSecuritySectionMounted] = useState(false);

  const [profileLoading, setProfileLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nameSubmitting, setNameSubmitting] = useState(false);
  const [nameSavedVisible, setNameSavedVisible] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pendingEmailChange, setPendingEmailChange] = useState<string | null>(
    null,
  );
  const [showEmailChangeForm, setShowEmailChangeForm] = useState(true);

  const tabButtonRefs = useRef<
    Partial<Record<PractitionerSettingsTabId, HTMLButtonElement>>
  >({});
  const authInitiallyResolvedRef = useRef(false);
  const loadedProfileUserIdRef = useRef<string | null>(null);
  const nameFormDirtyRef = useRef(false);
  const tabId = (tab: PractitionerSettingsTabId) =>
    `${formId}-settings-tab-${tab}`;
  const panelId = (tab: PractitionerSettingsTabId) =>
    `${formId}-settings-panel-${tab}`;

  useEffect(() => {
    if (activeTab === 'security') {
      setSecuritySectionMounted(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!authLoading) {
      authInitiallyResolvedRef.current = true;
    }
  }, [authLoading]);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  const setTab = useCallback(
    (tab: PractitionerSettingsTabId) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'account') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const qs = params.toString();
      router.replace(qs ? `/settings?${qs}` : '/settings', { scroll: false });
    },
    [router, searchParams],
  );

  const loadProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfileLoading(false);
      loadedProfileUserIdRef.current = null;
      nameFormDirtyRef.current = false;
      return;
    }

    const isInitialLoadForUser = loadedProfileUserIdRef.current !== userId;
    if (!isInitialLoadForUser) {
      return;
    }

    nameFormDirtyRef.current = false;
    setProfileLoading(true);
    setNameError(null);

    const [{ data, error }, { data: userData, error: userError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('display_name')
          .eq('id', userId)
          .maybeSingle(),
        supabase.auth.getUser(),
      ]);

    if (error) {
      setNameError('Unable to load your profile. Try again in a moment.');
      setProfileLoading(false);
      return;
    }
    if (userError) {
      setNameError(
        'Unable to load your account details. Try again in a moment.',
      );
      setProfileLoading(false);
      return;
    }
    if (data == null) {
      setNameError(
        'Your account is missing a profile record. Sign out and complete your invite link again, or contact support.',
      );
      setProfileLoading(false);
      return;
    }
    if (!nameFormDirtyRef.current) {
      const titleFromMetadata = readPractitionerTitleFromUserMetadata(
        userData.user,
      );
      const names = splitDisplayNameIntoPractitionerNameFields(
        data?.display_name,
        titleFromMetadata,
      );
      setTitle(names.title);
      setFirstName(names.firstName);
      setLastName(names.lastName);
    }
    setCurrentEmail(session.user.email ?? '');
    loadedProfileUserIdRef.current = userId;
    setProfileLoading(false);
  }, [session?.user?.email, session?.user?.id, supabase]);

  useEffect(() => {
    if (authLoading) {
      return;
    }
    void loadProfile();
  }, [authLoading, loadProfile, session?.user?.id]);

  useEffect(() => {
    if (authLoading || !session?.user?.id) {
      return;
    }
    setCurrentEmail(session.user.email ?? '');
  }, [authLoading, session?.user?.email, session?.user?.id]);

  useEffect(() => {
    if (authLoading || !session?.user?.id) {
      return;
    }
    void supabase.auth.getUser().then(({ data: { user } }) => {
      const pending = readPendingEmailChange(user);
      if (pending) {
        setPendingEmailChange(pending);
        setShowEmailChangeForm(false);
      }
    });
  }, [authLoading, session?.user?.id, supabase]);

  useEffect(() => {
    if (!pendingEmailChange) {
      return;
    }
    const normalizedCurrent = currentEmail.trim().toLowerCase();
    if (
      normalizedCurrent !== '' &&
      normalizedCurrent === pendingEmailChange.trim().toLowerCase()
    ) {
      setPendingEmailChange(null);
      setShowEmailChangeForm(true);
    }
  }, [currentEmail, pendingEmailChange]);

  useEffect(() => {
    return () => {
      if (nameSavedTimeoutRef.current) {
        clearTimeout(nameSavedTimeoutRef.current);
      }
    };
  }, []);

  const clearNameSaveFeedback = useCallback(() => {
    if (nameSavedTimeoutRef.current) {
      clearTimeout(nameSavedTimeoutRef.current);
      nameSavedTimeoutRef.current = null;
    }
    setNameSavedVisible(false);
  }, []);

  const showNameSaveFeedback = useCallback(() => {
    clearNameSaveFeedback();
    setNameSavedVisible(true);
    nameSavedTimeoutRef.current = setTimeout(() => {
      setNameSavedVisible(false);
      nameSavedTimeoutRef.current = null;
    }, NAME_SAVE_FEEDBACK_MS);
  }, [clearNameSaveFeedback]);

  const onNameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session?.user?.id) {
      return;
    }
    setNameSubmitting(true);
    setNameError(null);
    clearNameSaveFeedback();
    const displayName = combinePractitionerNameFieldsIntoDisplayName({
      title,
      firstName,
      lastName,
    });
    const trimmedTitle = title.trim();
    const [{ error: profileError }, { error: metadataError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .update({ display_name: displayName })
          .eq('id', session.user.id),
        supabase.auth.updateUser({
          data: {
            [PRACTITIONER_TITLE_USER_METADATA_KEY]: trimmedTitle || null,
          },
        }),
      ]);
    setNameSubmitting(false);
    if (profileError || metadataError) {
      setNameError('Unable to save your name. Try again.');
      announce('Unable to save your name.', { politeness: 'assertive' });
      return;
    }
    nameFormDirtyRef.current = false;
    showNameSaveFeedback();
    announce('Name saved.', { politeness: 'polite' });
  };

  const onEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) {
      return;
    }
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) {
      setEmailError('Enter a new email address.');
      return;
    }
    if (trimmed === (session.user.email ?? '').trim().toLowerCase()) {
      setEmailError('That is already your email address.');
      return;
    }
    setEmailSubmitting(true);
    setEmailError(null);
    const nextPath = '/settings?tab=account';
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error } = await supabase.auth.updateUser(
      { email: trimmed },
      { emailRedirectTo },
    );
    setEmailSubmitting(false);
    if (error) {
      setEmailError(error.message);
      announce(error.message, { politeness: 'assertive' });
      return;
    }
    setPendingEmailChange(trimmed);
    setShowEmailChangeForm(false);
    setNewEmail('');
    const msg = `Confirmation email sent to ${trimmed}. Open the link in that message to finish changing your email.`;
    announce(msg, { politeness: 'polite' });
  };

  const onTabKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLButtonElement>,
      current: PractitionerSettingsTabId,
    ) => {
      const currentIndex = TAB_ORDER.indexOf(current);
      if (currentIndex < 0) {
        return;
      }
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % TAB_ORDER.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = TAB_ORDER.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const target = TAB_ORDER[nextIndex];
      if (!target) {
        return;
      }
      setTab(target);
      tabButtonRefs.current[target]?.focus();
    },
    [setTab],
  );

  if (authLoading && !authInitiallyResolvedRef.current) {
    return (
      <p className="text-sm text-app-muted" role="status">
        Loading settings…
      </p>
    );
  }

  if (!session) {
    if (isPractitionerSignOutTransition(session)) {
      return (
        <p className="text-sm text-app-muted" role="status">
          Signing out…
        </p>
      );
    }
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-300">
        You must be signed in to open settings.
      </p>
    );
  }

  const tabLabels: Record<PractitionerSettingsTabId, string> = {
    account: 'Account',
    security: 'Security',
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Settings
        </h1>
        <p className="mt-2 text-sm text-app-muted">
          Manage your practitioner account and security preferences.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex flex-wrap gap-2 rounded-2xl border border-app-border/90 bg-app-surface/80 p-2 shadow-sm dark:border-app-border-dark/90 dark:bg-app-surface-dark/60"
      >
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={tabId(tab)}
            aria-controls={panelId(tab)}
            aria-selected={activeTab === tab ? 'true' : 'false'}
            tabIndex={activeTab === tab ? 0 : -1}
            className={tabClass(activeTab === tab)}
            ref={(node) => {
              tabButtonRefs.current[tab] = node ?? undefined;
            }}
            onKeyDown={(event) => onTabKeyDown(event, tab)}
            onClick={() => setTab(tab)}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={panelId('account')}
        aria-labelledby={tabId('account')}
        hidden={activeTab !== 'account'}
        tabIndex={0}
        className="space-y-8 outline-none"
      >
        {activeTab === 'account' ? (
          <>
            <section
              aria-labelledby={`${formId}-name-heading`}
              className={SETTINGS_SURFACE_CLASS}
            >
              <h2
                id={`${formId}-name-heading`}
                className="text-lg font-semibold text-app-ink"
              >
                Name
              </h2>
              <p className="mt-2 text-sm text-app-muted">
                Your name may appear when patients view who has access to their
                health data.
              </p>
              {profileLoading ? (
                <p className="mt-4 text-sm text-app-muted" role="status">
                  Loading profile…
                </p>
              ) : (
                <form
                  className="mt-6 grid gap-4 sm:grid-cols-2"
                  onSubmit={(e) => {
                    void onNameSubmit(e);
                  }}
                  noValidate
                >
                  <div className="space-y-2 sm:col-span-2">
                    <label
                      htmlFor={`${formId}-title`}
                      className="text-sm font-medium text-app-ink"
                    >
                      Title
                    </label>
                    <input
                      id={`${formId}-title`}
                      type="text"
                      autoComplete="honorific-prefix"
                      value={title}
                      onChange={(e) => {
                        nameFormDirtyRef.current = true;
                        clearNameSaveFeedback();
                        setTitle(e.target.value);
                      }}
                      className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring sm:max-w-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor={`${formId}-first-name`}
                      className="text-sm font-medium text-app-ink"
                    >
                      First name
                    </label>
                    <input
                      id={`${formId}-first-name`}
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => {
                        nameFormDirtyRef.current = true;
                        clearNameSaveFeedback();
                        setFirstName(e.target.value);
                      }}
                      className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor={`${formId}-last-name`}
                      className="text-sm font-medium text-app-ink"
                    >
                      Last name
                    </label>
                    <input
                      id={`${formId}-last-name`}
                      type="text"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => {
                        nameFormDirtyRef.current = true;
                        clearNameSaveFeedback();
                        setLastName(e.target.value);
                      }}
                      className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                    />
                  </div>
                  {nameError ? (
                    <p
                      role="alert"
                      className="sm:col-span-2 text-sm text-red-700 dark:text-red-300"
                    >
                      {nameError}
                    </p>
                  ) : null}
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={nameSubmitting}
                      aria-live="polite"
                      className="min-h-[44px] rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {nameSubmitting
                        ? 'Saving…'
                        : nameSavedVisible
                          ? 'Saved'
                          : 'Save name'}
                    </button>
                  </div>
                </form>
              )}
            </section>

            <section
              aria-labelledby={`${formId}-email-heading`}
              className={SETTINGS_SURFACE_CLASS}
            >
              <h2
                id={`${formId}-email-heading`}
                className="text-lg font-semibold text-app-ink"
              >
                Email
              </h2>
              <p className="mt-2 text-sm text-app-muted">
                {pendingEmailChange ? (
                  <>
                    Your sign-in email is still{' '}
                    <span className="font-medium text-app-ink">
                      {currentEmail || 'Not set'}
                    </span>
                    . Finish confirming{' '}
                    <span className="font-medium text-app-ink">
                      {pendingEmailChange}
                    </span>{' '}
                    using the link we emailed to that address.
                  </>
                ) : (
                  <>
                    Current address:{' '}
                    <span className="font-medium text-app-ink">
                      {currentEmail || 'Not set'}
                    </span>
                    . We will send a confirmation link to your new address
                    before the change takes effect.
                  </>
                )}
              </p>
              {pendingEmailChange ? (
                <div
                  className="mt-6 space-y-4"
                  role="status"
                  aria-labelledby={`${formId}-email-pending-heading`}
                >
                  <div className="rounded-xl border border-app-border/80 bg-app-bg p-4">
                    <h3
                      id={`${formId}-email-pending-heading`}
                      className="text-sm font-semibold text-app-ink"
                    >
                      Email change pending
                    </h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div>
                        <dt className="text-app-muted">Current address</dt>
                        <dd className="font-medium text-app-ink">
                          {currentEmail || 'Not set'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-app-muted">Changing to</dt>
                        <dd className="font-medium text-app-ink">
                          {pendingEmailChange}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-sm text-app-muted">
                      We sent a confirmation link to{' '}
                      <span className="font-medium text-app-ink">
                        {pendingEmailChange}
                      </span>
                      . Open that message to finish the change.
                    </p>
                  </div>
                  {!showEmailChangeForm ? (
                    <button
                      type="button"
                      className="min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                      onClick={() => {
                        setShowEmailChangeForm(true);
                        setEmailError(null);
                      }}
                    >
                      Use a different address
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!pendingEmailChange || showEmailChangeForm ? (
                <form
                  className="mt-6 space-y-4"
                  onSubmit={(e) => {
                    void onEmailSubmit(e);
                  }}
                  noValidate
                >
                  <div className="space-y-2">
                    <label
                      htmlFor={`${formId}-new-email`}
                      className="text-sm font-medium text-app-ink"
                    >
                      New email
                    </label>
                    <input
                      id={`${formId}-new-email`}
                      type="email"
                      autoComplete="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                    />
                  </div>
                  {emailError ? (
                    <p
                      role="alert"
                      className="text-sm text-red-700 dark:text-red-300"
                    >
                      {emailError}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={emailSubmitting}
                    className="min-h-[44px] rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {emailSubmitting ? 'Sending…' : 'Send confirmation email'}
                  </button>
                </form>
              ) : null}
            </section>

            <section
              aria-labelledby={`${formId}-sessions-heading`}
              className={SETTINGS_SURFACE_CLASS}
            >
              <h2
                id={`${formId}-sessions-heading`}
                className="text-lg font-semibold text-app-ink"
              >
                Sessions
              </h2>
              <p className="mt-2 text-sm text-app-muted">
                Sign out on every device where you are signed in to ABStrack.
                Use this on a shared computer or if you think someone else may
                have access to your account.
              </p>
              <button
                type="button"
                className="mt-4 min-h-[44px] rounded-full bg-red-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-700 dark:hover:bg-red-600"
                onClick={() => setSignOutEverywhereOpen(true)}
              >
                Sign out everywhere
              </button>
            </section>
          </>
        ) : null}
      </div>

      <div
        role="tabpanel"
        id={panelId('security')}
        aria-labelledby={tabId('security')}
        hidden={activeTab !== 'security'}
        tabIndex={0}
        className="outline-none"
      >
        {securitySectionMounted ? <SettingsSecuritySection /> : null}
      </div>

      <ConfirmDialog
        open={signOutEverywhereOpen}
        title="Sign out everywhere?"
        description="This ends your ABStrack session on this browser and signs you out on all other devices. You will need to sign in again everywhere."
        confirmLabel="Sign out everywhere"
        cancelLabel="Cancel"
        confirmBusyLabel="Signing out…"
        onConfirm={() => {
          announce('Signing out from all sessions.', { politeness: 'polite' });
          practitionerSignOutEverywhere();
          return undefined;
        }}
        onClose={() => setSignOutEverywhereOpen(false)}
      />
    </div>
  );
}
