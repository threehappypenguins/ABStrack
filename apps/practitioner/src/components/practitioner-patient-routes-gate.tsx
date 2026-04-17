'use client';

import type { PractitionerAppGate } from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { getPatientDataMfaBlockReason } from '@/lib/practitioner-patient-data-access';
import { usePractitionerVerifiedTotpCount } from '@/lib/use-practitioner-verified-totp';
import { PractitionerSignOutButton } from './practitioner-sign-out-button';

const MFA_BLOCK_COPY = {
  enrollment: {
    title: 'Set up two-factor authentication first',
    body: 'Patient records are available only after you enroll and verify at least one TOTP factor, then complete the MFA step for this session.',
    announce:
      'Patient data is blocked. Enroll and verify TOTP on the security setup page before opening patient records.',
  },
  aal2: {
    title: 'Complete two-factor sign-in for this session',
    body: 'Your account has MFA, but this session is not verified to the level required for patient data. Sign out and sign in again, then complete the two-factor prompt. You can also return to security setup for guidance.',
    announce:
      'Patient data is blocked until this session completes two-factor authentication. Sign out and sign in again, or open security setup.',
  },
} as const;

/**
 * Blocks rendering of practitioner patient-data routes until the session has verified TOTP
 * enrollment and JWT MFA assurance (AAL2). Announces blocking reasons for assistive technology
 * and provides keyboard-reachable actions.
 *
 * @param props - React children rendered only when MFA requirements are satisfied.
 * @returns Gate UI or nested routes.
 */
export function PractitionerPatientRoutesGate({
  children,
}: {
  children: ReactNode;
}) {
  const { announce } = useAnnounce();
  const { loading: authLoading, session, gate } = useAuth();
  const practitionerGate = gate.kind === 'practitioner' ? gate : null;
  const totpEnabled = gate.kind === 'practitioner';
  const {
    verifiedTotpCount,
    loading: totpLoading,
    error: totpError,
    refresh: refreshTotpFactors,
  } = usePractitionerVerifiedTotpCount(totpEnabled);

  const awaitingProfile = gate.kind === 'profile_loading';
  const showSpinner =
    authLoading ||
    awaitingProfile ||
    (gate.kind === 'practitioner' && totpLoading);

  const mfaGateHeadingRef = useRef<HTMLHeadingElement>(null);
  const signInHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastMfaBlockAnnounced = useRef<'enrollment' | 'aal2' | null>(null);

  const mfaBlockReason =
    practitionerGate == null
      ? null
      : getPatientDataMfaBlockReason(practitionerGate, verifiedTotpCount);

  useEffect(() => {
    if (mfaBlockReason !== 'enrollment' && mfaBlockReason !== 'aal2') {
      lastMfaBlockAnnounced.current = null;
      return;
    }
    if (lastMfaBlockAnnounced.current === mfaBlockReason) {
      return;
    }
    lastMfaBlockAnnounced.current = mfaBlockReason;
    announce(MFA_BLOCK_COPY[mfaBlockReason].announce, {
      politeness: 'assertive',
    });
    queueMicrotask(() => {
      mfaGateHeadingRef.current?.focus();
    });
  }, [announce, mfaBlockReason]);

  useEffect(() => {
    const showSignInGate = gate.kind === 'signed_out' || !session?.access_token;
    if (!showSignInGate || showSpinner) {
      return;
    }
    queueMicrotask(() => {
      signInHeadingRef.current?.focus();
    });
  }, [gate.kind, session?.access_token, showSpinner]);

  if (showSpinner) {
    return (
      <div
        id="practitioner-patient-gate-root"
        className="flex min-h-screen flex-col items-center justify-center bg-app-bg bg-app-gradient px-4 py-12 sm:px-6 lg:px-8"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <p className="text-center text-sm text-app-muted">
          Checking access to patient data…
        </p>
      </div>
    );
  }

  if (totpEnabled && totpError) {
    return (
      <div
        id="practitioner-patient-gate-root"
        className="mx-auto max-w-lg px-4 py-12 sm:px-6"
        role="alert"
      >
        <h1 className="text-xl font-semibold text-app-ink">
          Could not verify MFA status
        </h1>
        <p className="mt-3 text-sm text-app-muted">
          Try again. If this continues, sign out and sign back in.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refreshTotpFactors()}
            className="min-h-11 rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Try again
          </button>
          <PractitionerSignOutButton />
        </div>
      </div>
    );
  }

  if (gate.kind === 'signed_out' || !session?.access_token) {
    return (
      <div
        id="practitioner-patient-gate-root"
        className="mx-auto max-w-lg px-4 py-12 sm:px-6"
        role="region"
        aria-labelledby="patient-gate-sign-in-heading"
      >
        <h1
          id="patient-gate-sign-in-heading"
          className="text-xl font-semibold text-app-ink"
          tabIndex={-1}
          ref={signInHeadingRef}
        >
          Sign in required
        </h1>
        <p className="mt-3 text-sm text-app-muted">
          Sign in with your practitioner account to access patient workflows.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (gate.kind === 'profile_error') {
    return (
      <IdentityBarrier
        title="Could not load your profile"
        description="Something went wrong while loading your account. Try signing out and signing in again. If this keeps happening, try again later."
      />
    );
  }

  if (gate.kind === 'profile_missing') {
    return (
      <IdentityBarrier
        title="No profile for this account"
        description="This sign-in does not have an ABStrack profile yet. Practitioner accounts must be created through the correct invitation flow."
      />
    );
  }

  if (gate.kind === 'wrong_app_role') {
    return (
      <IdentityBarrier
        title="Wrong account type for this app"
        description={`This app is for healthcare practitioners. Your account is registered as ${gate.appRole}. Use the patient or caretaker app instead.`}
      />
    );
  }

  if (gate.kind === 'practitioner') {
    if (mfaBlockReason === 'enrollment' || mfaBlockReason === 'aal2') {
      const copy = MFA_BLOCK_COPY[mfaBlockReason];
      return (
        <div
          id="practitioner-patient-gate-root"
          className="mx-auto max-w-lg px-4 py-12 sm:px-6"
          role="region"
          aria-labelledby="patient-mfa-gate-heading"
        >
          <h1
            id="patient-mfa-gate-heading"
            ref={mfaGateHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-app-ink"
          >
            {copy.title}
          </h1>
          <p className="mt-3 text-sm text-app-muted">{copy.body}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Open security setup
            </Link>
            <PractitionerSignOutButton label="Sign out and try again" />
          </div>
        </div>
      );
    }

    return <>{children}</>;
  }

  return <UnexpectedGateFallback gate={gate} />;
}

function IdentityBarrier({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      id="practitioner-patient-gate-root"
      className="mx-auto max-w-lg px-4 py-12 sm:px-6"
      role="alert"
    >
      <h1 className="text-xl font-semibold text-app-ink">{title}</h1>
      <p className="mt-3 text-sm text-app-muted">{description}</p>
      <div className="mt-6">
        <PractitionerSignOutButton />
      </div>
    </div>
  );
}

function UnexpectedGateFallback({ gate }: { gate: PractitionerAppGate }) {
  return (
    <div
      id="practitioner-patient-gate-root"
      className="px-4 py-12"
      role="alert"
    >
      <p className="text-sm text-app-muted">
        Unexpected gate state: {gate.kind}. Please refresh or sign out.
      </p>
      <div className="mt-4">
        <PractitionerSignOutButton />
      </div>
    </div>
  );
}
