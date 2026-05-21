'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { ConfirmDialog } from '@/components/symptom-presets/ConfirmDialog';
import {
  type CaretakerAccessGetResponse,
  type CaretakerGrantDto,
  type CaretakerPendingInviteDto,
  caretakerEdgeClientPreflightErrorMessage,
  fetchPatientCaretakerAccessCancelPendingInvite,
  fetchPatientCaretakerAccessDelete,
  fetchPatientCaretakerAccessGet,
  fetchPatientCaretakerAccessPost,
} from '@/lib/patient/caretaker-edge-client';
import { normalizeEmailForLookup } from '@/lib/patient/normalize-email-for-lookup';
import { useAuth } from '@/lib/auth-provider';

function formatInviteExpiry(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return iso;
  }
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Patient settings: invite or link one active caretaker, revoke access, and cancel a pending email
 * invite via the Supabase Edge Function `patient-caretaker-access` (no Next.js secret key). Copy
 * reflects PRD §7 (caretaker ≈ patient capabilities for impaired-use scenarios; distinct from
 * practitioner).
 *
 * @returns Settings page content.
 */
export function CaretakerAccessPage() {
  const { announce } = useAnnounce();
  const { session, loading: authLoading } = useAuth();
  const formId = useId();
  const emailFieldId = `${formId}-caretaker-email`;

  const [grant, setGrant] = useState<CaretakerGrantDto | null | undefined>(
    undefined,
  );
  const [pendingInvite, setPendingInvite] =
    useState<CaretakerPendingInviteDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [cancelInviteSubmitting, setCancelInviteSubmitting] = useState(false);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadGrant = useCallback(async () => {
    setLoadError(null);
    let res: Response;
    try {
      res = await fetchPatientCaretakerAccessGet();
    } catch (err) {
      setGrant(null);
      setPendingInvite(null);
      setLoadError(
        caretakerEdgeClientPreflightErrorMessage(
          err,
          'You must be signed in to manage caretaker access.',
        ),
      );
      return;
    }
    if (res.status === 401) {
      setGrant(null);
      setPendingInvite(null);
      setLoadError('You must be signed in to manage caretaker access.');
      return;
    }
    if (res.status === 403) {
      setGrant(null);
      setPendingInvite(null);
      setLoadError(
        'Caretaker linking is only available to patient accounts—not practitioner or caretaker sign-ins.',
      );
      return;
    }
    if (!res.ok) {
      setGrant(null);
      setPendingInvite(null);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'server_misconfigured') {
        setLoadError(
          'Caretaker access is temporarily unavailable (Supabase Edge Function or secrets).',
        );
        return;
      }
      setLoadError('Unable to load caretaker access. Try again in a moment.');
      return;
    }
    const body = (await res.json()) as CaretakerAccessGetResponse;
    setGrant(body.grant);
    setPendingInvite(body.pendingInvite ?? null);
  }, []);

  useEffect(() => {
    if (authLoading || !session) {
      return;
    }
    void loadGrant();
  }, [authLoading, session, loadGrant]);

  const onCancelPendingInvite = async () => {
    setCancelInviteSubmitting(true);
    setFormError(null);
    try {
      const res = await fetchPatientCaretakerAccessCancelPendingInvite();
      const maybeJson = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const raw =
          typeof maybeJson.error === 'string' ? maybeJson.error : undefined;
        const msg =
          maybeJson.error === 'server_misconfigured'
            ? 'Caretaker access is temporarily unavailable (Supabase Edge Function or secrets).'
            : (raw ?? 'Unable to cancel the invite.');
        setFormError(msg);
        announce(msg, { politeness: 'assertive' });
        return;
      }
      announce('Pending caretaker invite cancelled.', { politeness: 'polite' });
      await loadGrant();
    } catch (err) {
      const msg = caretakerEdgeClientPreflightErrorMessage(
        err,
        'You must be signed in to cancel an invite.',
      );
      setFormError(msg);
      announce(msg, { politeness: 'assertive' });
    } finally {
      setCancelInviteSubmitting(false);
    }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      return;
    }
    const normalized = normalizeEmailForLookup(email);
    if (!normalized) {
      setFormError('Enter the caretaker email address.');
      return;
    }
    setInviteSubmitting(true);
    setFormError(null);
    let res: Response;
    try {
      res = await fetchPatientCaretakerAccessPost(normalized);
    } catch (err) {
      setInviteSubmitting(false);
      setFormError(
        caretakerEdgeClientPreflightErrorMessage(
          err,
          'You must be signed in to invite or link a caretaker.',
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
          ? `Please wait about ${Math.max(1, Math.round(maybeJson.retryAfterSeconds))} seconds before resending the invite.`
          : maybeJson.error === 'server_misconfigured'
            ? 'Caretaker access is temporarily unavailable (Supabase Edge Function or secrets).'
            : (raw ?? 'Unable to invite or link caretaker access.');
      setFormError(msg);
      announce(msg, { politeness: 'assertive' });
      return;
    }
    setEmail('');
    const outcome = maybeJson.outcome;
    if (outcome === 'invite_sent') {
      announce(
        'Invite email sent. The link in that message finishes caretaker setup in the mobile app or on user web.',
        { politeness: 'polite' },
      );
    } else if (outcome === 'already_linked') {
      announce('That caretaker is already linked to your account.', {
        politeness: 'polite',
      });
    } else {
      announce(
        'Caretaker linked. The caretaker can sign in on another device with full access to log episodes for you.',
        { politeness: 'polite' },
      );
    }
    await loadGrant();
  };

  const onRevoke = async () => {
    setRevokeError(null);
    setRevokeSubmitting(true);
    let res: Response;
    try {
      res = await fetchPatientCaretakerAccessDelete();
    } catch (err) {
      setRevokeSubmitting(false);
      const msg = caretakerEdgeClientPreflightErrorMessage(
        err,
        'You must be signed in to revoke caretaker access.',
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
          ? 'Caretaker access is temporarily unavailable (Supabase Edge Function or secrets).'
          : (raw ?? 'Unable to revoke caretaker access.');
      setRevokeError(msg);
      announce(msg, { politeness: 'assertive' });
      return false;
    }
    setRevokeError(null);
    announce('Caretaker access revoked.', { politeness: 'polite' });
    await loadGrant();
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
        You must be signed in to manage caretaker access.
      </div>
    );
  }

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
          Caretaker access
        </h1>
        <p className="mt-2 text-sm text-app-muted">
          A caretaker signs in with his or her own ABStrack account and uses the
          same logging flows as you, with matching data access, once the invite
          completes. Invite links open the ABStrack mobile app when tapped on a
          phone (mobile-first), and the same link completes caretaker sign-up on
          user web when opened in a browser. This is separate from a healthcare
          practitioner: the practitioner web app is read-only and does not
          replace you in patient flows.
        </p>
      </div>

      {loadError ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {loadError}
        </p>
      ) : null}

      {grant === undefined && !loadError ? (
        <p className="text-sm text-app-muted" role="status">
          Loading caretaker access…
        </p>
      ) : null}

      {pendingInvite && !grant && !loadError ? (
        <section
          aria-labelledby={`${formId}-pending-heading`}
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        >
          <h2
            id={`${formId}-pending-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Invite pending
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            We sent an email to{' '}
            <span className="font-medium text-app-ink">
              {pendingInvite.inviteeEmail}
            </span>
            . The link in that message finishes setup in the mobile app or on
            user web. Invite expires{' '}
            {formatInviteExpiry(pendingInvite.expiresAt)}.
          </p>
          <button
            type="button"
            className="mt-4 min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
            disabled={cancelInviteSubmitting}
            onClick={() => void onCancelPendingInvite()}
          >
            {cancelInviteSubmitting ? 'Working…' : 'Cancel pending invite'}
          </button>
        </section>
      ) : null}

      {grant && !loadError ? (
        <section
          aria-labelledby={`${formId}-active-heading`}
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        >
          <h2
            id={`${formId}-active-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Active caretaker
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            You can have one active caretaker. Access stays in place until you
            revoke below.
          </p>
          <dl className="mt-4 space-y-2 text-sm text-app-ink">
            <div>
              <dt className="font-medium text-app-muted">Display name</dt>
              <dd>
                {grant.caretakerDisplayName?.trim() ||
                  'No display name on the caretaker profile'}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="mt-6 min-h-[44px] rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-70 dark:bg-red-700 dark:hover:bg-red-600"
            disabled={revokeSubmitting}
            onClick={() => {
              setRevokeError(null);
              setRevokeOpen(true);
            }}
          >
            Revoke caretaker access
          </button>
        </section>
      ) : null}

      {!pendingInvite && !grant && grant !== undefined && !loadError ? (
        <section
          aria-labelledby={`${formId}-invite-heading`}
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        >
          <h2
            id={`${formId}-invite-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Invite or link a caretaker
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            Enter your support person's email, and we will send an invite.
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
                Caretaker email
              </label>
              <input
                id={emailFieldId}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                placeholder="caretaker@example.com"
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
              className="min-h-[44px] rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {inviteSubmitting ? 'Sending…' : 'Send invite or link'}
            </button>
          </form>
        </section>
      ) : null}

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke caretaker access?"
        description="The caretaker will no longer be able to read or log your health data. This does not delete anything already saved. You can link a caretaker again later if you need to."
        confirmLabel="Revoke access"
        cancelLabel="Keep caretaker"
        confirmBusyLabel="Revoking…"
        onConfirm={() => onRevoke()}
        onClose={() => {
          setRevokeOpen(false);
          setRevokeError(null);
        }}
      >
        {revokeError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {revokeError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
