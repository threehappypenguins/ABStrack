'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { CARETAKER_INVITE_SET_PASSWORD_FROM } from '@/lib/auth/caretaker-invite-password';
import {
  caretakerEdgeClientPreflightErrorMessage,
  fetchPatientCaretakerAccessFinalize,
} from '@/lib/patient/caretaker-edge-client';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { ensureProfileRow } from '@abstrack/supabase';

type JoinState =
  | { kind: 'loading' }
  | { kind: 'need_sign_in' }
  | { kind: 'missing_invite' }
  | { kind: 'wrong_role'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

/**
 * Post-invite landing: after the caretaker accepts the Supabase email link, the session may need a
 * caretaker profile row and a call to finalize the `caretaker_invites` row into `caretaker_access`.
 *
 * @returns Caretaker join page.
 */
export default function CaretakerJoinPage() {
  const { announce } = useAnnounce();
  const statusId = useId();
  const [state, setState] = useState<JoinState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState({ kind: 'loading' });

      try {
        const supabase = createBrowserClient();
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

        const inviteIdRaw = user.user_metadata?.abstrack_caretaker_invite_id;
        const inviteId =
          typeof inviteIdRaw === 'string' && inviteIdRaw.trim().length > 0
            ? inviteIdRaw.trim()
            : null;

        if (!inviteId) {
          if (!cancelled) {
            setState({ kind: 'missing_invite' });
          }
          return;
        }

        const { data: profile, error: profileReadErr } = await supabase
          .from('profiles')
          .select('app_role')
          .eq('id', user.id)
          .maybeSingle();

        if (profileReadErr) {
          if (!cancelled) {
            setState({
              kind: 'error',
              message: 'Unable to read your profile. Try again in a moment.',
            });
          }
          return;
        }

        let appRole = profile?.app_role;
        if (!profile) {
          const ensured = await ensureProfileRow(
            supabase,
            user.id,
            'caretaker',
          );
          if (!ensured.ok) {
            if (!cancelled) {
              setState({
                kind: 'error',
                message:
                  ensured.message ||
                  'Unable to create your caretaker profile. Try again or contact support.',
              });
            }
            return;
          }
          const { data: afterEnsure, error: afterEnsureErr } = await supabase
            .from('profiles')
            .select('app_role')
            .eq('id', user.id)
            .maybeSingle();
          if (afterEnsureErr || !afterEnsure) {
            if (!cancelled) {
              setState({
                kind: 'error',
                message:
                  'Unable to verify your profile after sign-up. Try again in a moment.',
              });
            }
            return;
          }
          appRole = afterEnsure.app_role;
        }

        if (appRole !== 'caretaker') {
          if (!cancelled) {
            setState({
              kind: 'wrong_role',
              message:
                'This invite is for a caretaker account, but your profile is not set to caretaker. Use the account your patient invited, or contact support.',
            });
          }
          return;
        }

        let res: Response;
        try {
          res = await fetchPatientCaretakerAccessFinalize(inviteId);
        } catch (err) {
          if (!cancelled) {
            const msg = caretakerEdgeClientPreflightErrorMessage(
              err,
              'Your session token is missing or expired. Open the invite link from your email again to sign in, then return to this page.',
            );
            setState({ kind: 'error', message: msg });
            announce(msg, { politeness: 'assertive' });
          }
          return;
        }

        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          const raw =
            typeof body.error === 'string'
              ? body.error
              : 'Invite could not be completed.';
          if (!cancelled) {
            setState({ kind: 'error', message: raw });
            announce(raw, { politeness: 'assertive' });
          }
          return;
        }

        if (!cancelled) {
          setState({ kind: 'done' });
          announce('You are now linked as this patient’s caretaker.', {
            politeness: 'polite',
          });
        }
      } catch (err) {
        if (!cancelled) {
          const msg = caretakerEdgeClientPreflightErrorMessage(
            err,
            'Unable to read your session. Open the invite link from your email again, or reload this page.',
          );
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

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-bold text-app-ink">Caretaker invite</h1>
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
                  : 'You are connected as this patient’s caretaker. Create a password so you can sign in with your email next time—or go home and do it later from the login page using Forgot password.'}
      </p>
      {state.kind === 'need_sign_in' ? (
        <Link
          href="/login"
          className="min-h-[44px] rounded-full bg-app-primary-solid px-5 py-3 text-center text-sm font-semibold text-app-on-primary-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
        >
          Go to sign in
        </Link>
      ) : null}
      {state.kind === 'done' ? (
        <div className="flex flex-col gap-3">
          <Link
            href={`/update-password?from=${CARETAKER_INVITE_SET_PASSWORD_FROM}`}
            className="min-h-[44px] rounded-full bg-app-primary-solid px-5 py-3 text-center text-sm font-semibold text-app-on-primary-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
          >
            Create password
          </Link>
          <Link
            href="/"
            className="min-h-[44px] rounded-full border border-app-border px-5 py-3 text-center text-sm font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
          >
            Go to home
          </Link>
        </div>
      ) : null}
      {state.kind === 'error' || state.kind === 'wrong_role' ? (
        <button
          type="button"
          className="min-h-[44px] rounded-full border border-app-border px-5 text-sm font-semibold text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
          onClick={() => {
            window.location.reload();
          }}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
