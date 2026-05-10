'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { ConfirmDialog } from '@/components/symptom-presets/ConfirmDialog';
import {
  type CaretakerAccessGetResponse,
  type CaretakerGrantDto,
  type CaretakerPendingInviteDto,
  fetchPatientCaretakerAccessCancelPendingInvite,
  fetchPatientCaretakerAccessDelete,
  fetchPatientCaretakerAccessGet,
  fetchPatientCaretakerAccessPost,
} from '@/lib/patient/caretaker-edge-client';
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
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const loadGrant = useCallback(async () => {
    setLoadError(null);
    let res: Response;
    try {
      res = await fetchPatientCaretakerAccessGet();
    } catch {
      setGrant(null);
      setPendingInvite(null);
      setLoadError('You must be signed in to manage caretaker access.');
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
    setBusy(true);
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
    } catch {
      const msg = 'You must be signed in to cancel an invite.';
      setFormError(msg);
      announce(msg, { politeness: 'assertive' });
    } finally {
      setBusy(false);
    }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      return;
    }
    const trimmed = email.trim();
    if (!trimmed) {
      setFormError('Enter the caretaker’s email address.');
      return;
    }
    setBusy(true);
    setFormError(null);
    let res: Response;
    try {
      res = await fetchPatientCaretakerAccessPost(trimmed);
    } catch {
      setBusy(false);
      setFormError('You must be signed in to invite or link a caretaker.');
      return;
    }
    const maybeJson = (await res.json().catch(() => ({}))) as {
      error?: string;
      outcome?: string;
    };
    setBusy(false);
    if (!res.ok) {
      const raw =
        typeof maybeJson.error === 'string' ? maybeJson.error : undefined;
      const msg =
        maybeJson.error === 'server_misconfigured'
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
        'Invite email sent. They should open the link in that message to create their caretaker account and connect to you.',
        { politeness: 'polite' },
      );
    } else if (outcome === 'already_linked') {
      announce('That caretaker is already linked to your account.', {
        politeness: 'polite',
      });
    } else {
      announce(
        'Caretaker linked. They can sign in on their own device with full access to log episodes for you.',
        { politeness: 'polite' },
      );
    }
    await loadGrant();
  };

  const onRevoke = async () => {
    setBusy(true);
    let res: Response;
    try {
      res = await fetchPatientCaretakerAccessDelete();
    } catch {
      setBusy(false);
      announce('You must be signed in to revoke caretaker access.', {
        politeness: 'assertive',
      });
      return false;
    }
    const maybeJson = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    setBusy(false);
    if (!res.ok) {
      const raw =
        typeof maybeJson.error === 'string' ? maybeJson.error : undefined;
      const msg =
        maybeJson.error === 'server_misconfigured'
          ? 'Caretaker access is temporarily unavailable (Supabase Edge Function or secrets).'
          : (raw ?? 'Unable to revoke caretaker access.');
      announce(msg, { politeness: 'assertive' });
      return false;
    }
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
          A caretaker signs in with their own ABStrack account and can use the
          same logging flows as you—helpful when you are impaired or need
          someone to record an episode on your behalf. This is separate from a
          healthcare practitioner: practitioners have their own app, read-only
          access, and cannot replace you in the patient prompt flows.
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
            . They should use the link in that message to finish setup. Invite
            expires {formatInviteExpiry(pendingInvite.expiresAt)}.
          </p>
          <button
            type="button"
            className="mt-4 min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={() => void onCancelPendingInvite()}
          >
            {busy ? 'Working…' : 'Cancel pending invite'}
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
            You can have one active caretaker. They stay authorized until you
            revoke access below.
          </p>
          <dl className="mt-4 space-y-2 text-sm text-app-ink">
            <div>
              <dt className="font-medium text-app-muted">Display name</dt>
              <dd>
                {grant.caretakerDisplayName?.trim() ||
                  'Not set on their profile'}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="mt-6 min-h-[44px] rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-70 dark:bg-red-700 dark:hover:bg-red-600"
            disabled={busy}
            onClick={() => setRevokeOpen(true)}
          >
            Revoke caretaker access
          </button>
        </section>
      ) : null}

      {!grant && grant !== undefined && !loadError ? (
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
            Enter their email. If they do not have an ABStrack account yet, we
            send an invite so they can create a caretaker account and connect to
            you. If they already signed up as a caretaker, we link them
            immediately instead.
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
              disabled={busy}
              className="min-h-[44px] rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send invite or link'}
            </button>
          </form>
        </section>
      ) : null}

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke caretaker access?"
        description="They will no longer be able to read or log your health data. This does not delete anything already saved. You can link a caretaker again later if you need to."
        confirmLabel="Revoke access"
        cancelLabel="Keep caretaker"
        confirmBusyLabel="Revoking…"
        onConfirm={() => onRevoke()}
        onClose={() => setRevokeOpen(false)}
      />
    </div>
  );
}
