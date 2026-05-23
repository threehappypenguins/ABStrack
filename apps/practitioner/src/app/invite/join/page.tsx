'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { getAccessTokenFromSession } from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { completePractitionerInviteAfterAuth } from '@/lib/practitioner-invite-complete';
import { PRACTITIONER_INVITE_SET_PASSWORD_FROM } from '@/lib/practitioner-invite-join';
import { practitionerUserHasPasswordSignIn } from '@/lib/practitioner-password-sign-in';

type JoinState =
  | { kind: 'loading' }
  | { kind: 'need_sign_in' }
  | { kind: 'missing_invite' }
  | { kind: 'wrong_role'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; passwordSignInEnabled: boolean };

/**
 * Post-invite landing after the practitioner accepts the Supabase email link. Finalizes the
 * `practitioner_invites` row into `practitioner_access`, then offers optional password setup or
 * magic-link access to the patient workspace (TOTP is required only after a password is set).
 *
 * @returns Practitioner invite join page.
 */
export default function PractitionerInviteJoinPage() {
  const { announce } = useAnnounce();
  const statusId = useId();
  const [state, setState] = useState<JoinState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState({ kind: 'loading' });

      try {
        const supabase = getSupabaseBrowserClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          if (!cancelled) {
            setState({ kind: 'need_sign_in' });
          }
          return;
        }

        const inviteIdRaw = user.user_metadata?.abstrack_practitioner_invite_id;
        const inviteId =
          typeof inviteIdRaw === 'string' && inviteIdRaw.trim().length > 0
            ? inviteIdRaw.trim()
            : null;

        if (!inviteId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('app_role')
            .eq('id', user.id)
            .maybeSingle();
          if (!cancelled && profile?.app_role === 'practitioner') {
            const passwordSignInEnabled =
              practitionerUserHasPasswordSignIn(user);
            setState({ kind: 'done', passwordSignInEnabled });
            announce(
              passwordSignInEnabled
                ? 'Your practitioner account is ready. Set up two-factor authentication before opening patient records.'
                : 'Your practitioner account is ready. You can open the patient workspace or create a password for email sign-in.',
              { politeness: 'polite' },
            );
          } else if (!cancelled) {
            setState({ kind: 'missing_invite' });
          }
          return;
        }

        const { accessToken, error: tokenError } =
          await getAccessTokenFromSession(supabase);
        const token = accessToken ?? '';
        if (tokenError) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message:
                'Unable to verify your session. Open the invite link from your email again.',
            });
          }
          return;
        }
        if (!token) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message:
                'Your session token is missing. Open the invite link from your email again.',
            });
          }
          return;
        }

        const result = await completePractitionerInviteAfterAuth(
          token,
          inviteId,
        );
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          const msg = result.message;
          if (/practitioner account|app_role|profile/i.test(msg)) {
            setState({ kind: 'wrong_role', message: msg });
          } else {
            setState({ kind: 'error', message: msg });
          }
          announce(msg, { politeness: 'assertive' });
          return;
        }

        const { error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) {
          console.warn(
            'Practitioner invite join: refreshSession after finalize',
            refreshErr,
          );
        }

        const {
          data: { user: activeUser },
          error: refreshedUserError,
        } = await supabase.auth.getUser();

        if (refreshedUserError || !activeUser) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message:
                'Unable to verify your session after completing the invite. Open the invite link again.',
            });
          }
          return;
        }

        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('app_role')
          .eq('id', activeUser.id)
          .maybeSingle();

        if (profileErr) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message: 'Unable to verify your profile. Try again in a moment.',
            });
          }
          return;
        }

        if (!profile || profile.app_role !== 'practitioner') {
          if (!cancelled) {
            setState({
              kind: 'wrong_role',
              message:
                'This invite is for a healthcare practitioner account, but your profile is not set to practitioner. Use the email your patient invited, or contact support.',
            });
          }
          return;
        }

        if (!cancelled) {
          const passwordSignInEnabled =
            practitionerUserHasPasswordSignIn(activeUser);
          setState({ kind: 'done', passwordSignInEnabled });
          announce(
            passwordSignInEnabled
              ? 'You are linked to your patient. Set up two-factor authentication, then open the patient workspace.'
              : 'You are linked to your patient. Open the patient workspace, or create a password if you want email sign-in later.',
            { politeness: 'polite' },
          );
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error && err.message.trim().length > 0
              ? err.message
              : 'Unable to complete your invite. Open the link from your email again, or reload this page.';
          setState({ kind: 'error', message: msg });
          announce(msg, { politeness: 'assertive' });
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [announce]);

  const donePasswordSet = state.kind === 'done' && state.passwordSignInEnabled;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12 sm:px-6"
    >
      <h1 className="text-2xl font-bold tracking-tight text-app-ink">
        Welcome to ABStrack Practitioner
      </h1>
      <p id={statusId} className="text-sm text-app-muted" role="status">
        {state.kind === 'loading'
          ? 'Completing your invite…'
          : state.kind === 'need_sign_in'
            ? 'Sign in from the link in your email to finish.'
            : state.kind === 'missing_invite'
              ? 'No invite was found on this sign-in. Open the latest email from your patient and use the link there.'
              : state.kind === 'wrong_role'
                ? state.message
                : state.kind === 'error'
                  ? state.message
                  : donePasswordSet
                    ? 'Your account is linked. Because you use a password to sign in, you must set up two-factor authentication (TOTP) before opening patient records.'
                    : 'Your account is linked. You can keep signing in with magic links from email, or create a password if you want email and password sign-in. Two-factor authentication is only required when you use a password.'}
      </p>
      {state.kind === 'need_sign_in' ? (
        <Link
          href="/login"
          className="min-h-[44px] rounded-full bg-app-primary-solid px-5 py-3 text-center text-sm font-semibold text-app-on-primary-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Go to sign in
        </Link>
      ) : null}
      {state.kind === 'done' ? (
        <div className="flex flex-col gap-3">
          {donePasswordSet ? (
            <Link
              href="/"
              className="min-h-[44px] rounded-full bg-app-primary-solid px-5 py-3 text-center text-sm font-semibold text-app-on-primary-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Set up two-factor authentication
            </Link>
          ) : (
            <Link
              href="/patients"
              className="min-h-[44px] rounded-full bg-app-primary-solid px-5 py-3 text-center text-sm font-semibold text-app-on-primary-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Go to patient workspace
            </Link>
          )}
          {!donePasswordSet ? (
            <Link
              href={`/update-password?from=${PRACTITIONER_INVITE_SET_PASSWORD_FROM}`}
              className="min-h-[44px] rounded-full border border-app-border px-5 py-3 text-center text-sm font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Create a password (optional)
            </Link>
          ) : null}
          {!donePasswordSet ? (
            <p className="text-xs text-app-muted">
              If you create a password, you will need to enroll TOTP before
              patient data access. Magic-link sign-in alone does not require
              TOTP.
            </p>
          ) : null}
        </div>
      ) : null}
      {state.kind === 'error' || state.kind === 'wrong_role' ? (
        <button
          type="button"
          className="min-h-[44px] rounded-full border border-app-border px-5 text-sm font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => {
            window.location.reload();
          }}
        >
          Try again
        </button>
      ) : null}
      {state.kind === 'missing_invite' ? (
        <Link
          href="/patients"
          className="min-h-[44px] rounded-full border border-app-border px-5 py-3 text-center text-sm font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
        >
          Go to patient workspace
        </Link>
      ) : null}
    </main>
  );
}
