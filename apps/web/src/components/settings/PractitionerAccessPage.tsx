'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { ConfirmDialog } from '@/components/symptom-presets/ConfirmDialog';
import {
  type PractitionerAccessGetResponse,
  type PractitionerGrantDto,
  fetchPatientPractitionerAccessGet,
  fetchPatientPractitionerAccessPostInvite,
  fetchPatientPractitionerAccessResendInvite,
  fetchPatientPractitionerAccessRevoke,
  practitionerEdgeClientPreflightErrorMessage,
} from '@/lib/patient/practitioner-edge-client';
import { normalizeEmailForLookup } from '@/lib/patient/normalize-email-for-lookup';
import { useAuth } from '@/lib/auth-provider';

/**
 * Patient settings: invite or link healthcare practitioners who use the separate practitioner web app
 * (read-only access after they complete mandatory TOTP; PRD §8). Grants and revokes go through the
 * `patient-practitioner-access` Edge Function.
 *
 * @returns Settings page content.
 */
export function PractitionerAccessPage() {
  const { announce } = useAnnounce();
  const { session, loading: authLoading } = useAuth();
  const formId = useId();
  const emailFieldId = `${formId}-practitioner-email`;

  const [grants, setGrants] = useState<PractitionerGrantDto[] | undefined>(
    undefined,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [resendSubmitting, setResendSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PractitionerGrantDto | null>(
    null,
  );
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    setLoadError(null);
    let res: Response;
    try {
      res = await fetchPatientPractitionerAccessGet();
    } catch (err) {
      setGrants([]);
      setLoadError(
        practitionerEdgeClientPreflightErrorMessage(
          err,
          'You must be signed in to manage practitioner access.',
        ),
      );
      return;
    }
    if (res.status === 401) {
      setGrants([]);
      setLoadError('You must be signed in to manage practitioner access.');
      return;
    }
    if (res.status === 403) {
      setGrants([]);
      setLoadError(
        'Practitioner sharing is only available to patient accounts—not practitioner or caretaker sign-ins.',
      );
      return;
    }
    if (!res.ok) {
      setGrants([]);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'server_misconfigured') {
        setLoadError(
          'Practitioner access is temporarily unavailable (Supabase Edge Function or secrets).',
        );
        return;
      }
      setLoadError(
        'Unable to load practitioner access. Try again in a moment.',
      );
      return;
    }
    const body = (await res.json()) as PractitionerAccessGetResponse;
    setGrants(body.grants ?? []);
  }, []);

  useEffect(() => {
    if (authLoading || !session) {
      return;
    }
    void loadGrants();
  }, [authLoading, session, loadGrants]);

  const onInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) {
      return;
    }
    const normalized = normalizeEmailForLookup(email);
    if (!normalized) {
      setFormError('Enter the practitioner email address.');
      return;
    }
    setInviteSubmitting(true);
    setFormError(null);
    let res: Response;
    try {
      res = await fetchPatientPractitionerAccessPostInvite(normalized);
    } catch (err) {
      setInviteSubmitting(false);
      setFormError(
        practitionerEdgeClientPreflightErrorMessage(
          err,
          'You must be signed in to invite a practitioner.',
        ),
      );
      return;
    }
    const maybeJson = (await res.json().catch(() => ({}))) as {
      error?: string;
      outcome?: string;
      retryAfterSeconds?: number;
    };
    setInviteSubmitting(false);
    if (!res.ok) {
      const raw =
        typeof maybeJson.error === 'string' ? maybeJson.error : undefined;
      const msg =
        res.status === 429 &&
        typeof maybeJson.retryAfterSeconds === 'number' &&
        Number.isFinite(maybeJson.retryAfterSeconds)
          ? `Please wait about ${Math.max(1, Math.round(maybeJson.retryAfterSeconds))} seconds before sending another invite.`
          : maybeJson.error === 'server_misconfigured'
            ? 'Practitioner access is temporarily unavailable (Supabase Edge Function or secrets).'
            : (raw ?? 'Unable to invite or link practitioner access.');
      setFormError(msg);
      announce(msg, { politeness: 'assertive' });
      return;
    }
    setEmail('');
    const outcome = maybeJson.outcome;
    if (outcome === 'invite_sent') {
      announce(
        'Invite sent. They should open the link in the practitioner web app and complete two-factor setup before viewing your data.',
        { politeness: 'polite' },
      );
    } else if (outcome === 'already_linked') {
      announce('That practitioner is already linked to your account.', {
        politeness: 'polite',
      });
    } else {
      announce(
        'Practitioner linked. They can sign in on the practitioner app when you have granted access.',
        { politeness: 'polite' },
      );
    }
    await loadGrants();
  };

  const onResend = async (targetEmail: string) => {
    setResendSubmitting(true);
    setFormError(null);
    let res: Response;
    try {
      res = await fetchPatientPractitionerAccessResendInvite(
        normalizeEmailForLookup(targetEmail),
      );
    } catch (err) {
      setResendSubmitting(false);
      const msg = practitionerEdgeClientPreflightErrorMessage(
        err,
        'You must be signed in to resend an invite.',
      );
      setFormError(msg);
      announce(msg, { politeness: 'assertive' });
      return;
    }
    const maybeJson = (await res.json().catch(() => ({}))) as {
      error?: string;
      retryAfterSeconds?: number;
    };
    setResendSubmitting(false);
    if (!res.ok) {
      const raw =
        typeof maybeJson.error === 'string' ? maybeJson.error : undefined;
      const msg =
        res.status === 429 &&
        typeof maybeJson.retryAfterSeconds === 'number' &&
        Number.isFinite(maybeJson.retryAfterSeconds)
          ? `Please wait about ${Math.max(1, Math.round(maybeJson.retryAfterSeconds))} seconds before resending the invite.`
          : (raw ?? 'Unable to resend the invite.');
      setFormError(msg);
      announce(msg, { politeness: 'assertive' });
      return;
    }
    announce('Invite email resent.', { politeness: 'polite' });
  };

  const onRevoke = async () => {
    if (!revokeTarget) {
      return false;
    }
    setRevokeError(null);
    setRevokeSubmitting(true);
    let res: Response;
    try {
      res = await fetchPatientPractitionerAccessRevoke(
        revokeTarget.practitionerUserId,
      );
    } catch (err) {
      setRevokeSubmitting(false);
      const msg = practitionerEdgeClientPreflightErrorMessage(
        err,
        'You must be signed in to revoke practitioner access.',
      );
      setRevokeError(msg);
      announce(msg, { politeness: 'assertive' });
      return false;
    }
    const maybeJson = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    setRevokeSubmitting(false);
    if (!res.ok) {
      const raw =
        typeof maybeJson.error === 'string' ? maybeJson.error : undefined;
      const msg =
        maybeJson.error === 'server_misconfigured'
          ? 'Practitioner access is temporarily unavailable (Supabase Edge Function or secrets).'
          : (raw ?? 'Unable to revoke practitioner access.');
      setRevokeError(msg);
      announce(msg, { politeness: 'assertive' });
      return false;
    }
    setRevokeError(null);
    announce(
      'Practitioner access revoked. They can no longer load your data on new requests; anything they already saw is not erased.',
      { politeness: 'polite' },
    );
    setRevokeTarget(null);
    await loadGrants();
    return undefined;
  };

  if (authLoading) {
    return (
      <div className="w-full space-y-4">
        <p className="text-sm text-app-muted" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div role="alert" className="text-sm text-red-700 dark:text-red-300">
        You must be signed in to manage practitioner access.
      </div>
    );
  }

  const grantLabel = (g: PractitionerGrantDto) =>
    g.practitionerEmail?.trim() ||
    g.practitionerDisplayName?.trim() ||
    'Practitioner account';

  return (
    <div className="w-full space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
          Practitioner access
        </h1>
        <p className="mt-2 text-sm text-app-muted">
          Enter your clinician&apos;s email to send an invitation. They sign in
          only on the separate ABStrack practitioner web app (not this patient
          app), complete mandatory two-factor authentication, and can then read
          your shared health data while access stays active. Revoking stops
          future reads; it does not erase data they may already have viewed (PRD
          §8).
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {loadError}
        </p>
      ) : null}

      {grants === undefined && !loadError ? (
        <p className="text-sm text-app-muted" role="status">
          Loading practitioner access…
        </p>
      ) : null}

      {grants && grants.length > 0 && !loadError ? (
        <section
          aria-labelledby={`${formId}-active-heading`}
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        >
          <h2
            id={`${formId}-active-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Active practitioners
          </h2>
          <ul className="mt-4 space-y-4">
            {grants.map((g) => (
              <li
                key={g.id}
                className="rounded-xl border border-app-border/80 bg-app-bg p-4"
              >
                <p className="text-sm font-medium text-app-ink">
                  {grantLabel(g)}
                </p>
                {g.practitionerDisplayName?.trim() &&
                g.practitionerEmail?.trim() ? (
                  <p className="mt-1 text-xs text-app-muted">
                    {g.practitionerDisplayName}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {g.practitionerEmail?.trim() ? (
                    <button
                      type="button"
                      className="min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={resendSubmitting}
                      onClick={() => void onResend(g.practitionerEmail ?? '')}
                    >
                      {resendSubmitting ? 'Working…' : 'Resend invite email'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="min-h-[44px] rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-70 dark:bg-red-700 dark:hover:bg-red-600"
                    disabled={revokeSubmitting}
                    onClick={() => {
                      setRevokeError(null);
                      setRevokeTarget(g);
                    }}
                  >
                    Revoke access
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loadError ? (
        <section
          aria-labelledby={`${formId}-invite-heading`}
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        >
          <h2
            id={`${formId}-invite-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Invite a practitioner
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            If they already have a practitioner ABStrack account, linking is
            instant after you confirm their email.
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              void onInvite(e);
            }}
            noValidate
          >
            <div className="space-y-2">
              <label
                htmlFor={emailFieldId}
                className="text-sm font-medium text-app-ink"
              >
                Practitioner email
              </label>
              <input
                id={emailFieldId}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                placeholder="clinician@hospital.example"
              />
            </div>
            {formError ? (
              <p
                className="text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {formError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={inviteSubmitting}
              className="min-h-[44px] rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {inviteSubmitting ? 'Sending…' : 'Send invite or link'}
            </button>
          </form>
        </section>
      ) : null}

      <ConfirmDialog
        open={revokeTarget != null}
        title="Revoke practitioner access?"
        description="They will no longer be authorized to read your health data on new requests. This does not delete anything they may already have seen. You can invite them again later if you need to."
        confirmLabel="Revoke access"
        cancelLabel="Keep access"
        confirmBusyLabel="Revoking…"
        onConfirm={() => onRevoke()}
        onClose={() => {
          setRevokeTarget(null);
          setRevokeError(null);
        }}
      >
        {revokeTarget ? (
          <p className="text-sm text-app-muted">
            Practitioner:{' '}
            <span className="font-medium text-app-ink">
              {grantLabel(revokeTarget)}
            </span>
          </p>
        ) : null}
        {revokeError ? (
          <p
            role="alert"
            className="mt-2 text-sm text-red-700 dark:text-red-300"
          >
            {revokeError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
