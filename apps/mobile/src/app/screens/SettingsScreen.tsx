import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { announce } from '@abstrack/ui/native';
import { signOut } from '@abstrack/supabase';
import {
  getRequireReauthOnOpenPreference,
  setRequireReauthOnOpenPreference,
} from '../reauth-preference';
import { mapAuthError } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import {
  formatPowerSyncReplicaDiagnosticsMessage,
  isPowerSyncReplicaDiagnosticsEnabled,
  runPowerSyncReplicaDiagnostics,
} from '../../lib/powersync/powersync-replica-diagnostics';
import { usePowerSyncBridgeState } from '../../lib/powersync/PowerSyncSessionBridge';
import type { MainStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';
import type { ThemePreference } from '../theme-preference';
import {
  CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP,
  fetchCaretakerAccessCancelPendingInvite,
  fetchCaretakerAccessDelete,
  fetchCaretakerAccessGet,
  fetchCaretakerAccessPost,
  isMissingPublishableKeyForCaretakerEdge,
  resolvePatientCaretakerAccessUrl,
} from '../../lib/patient-caretaker-edge-api';
import {
  PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP,
  fetchPractitionerAccessCancelPendingInvite,
  fetchPractitionerAccessGet,
  fetchPractitionerAccessPostInvite,
  fetchPractitionerAccessResendInvite,
  fetchPractitionerAccessRevoke,
  isMissingPublishableKeyForPractitionerEdge,
  resolvePatientPractitionerAccessUrl,
} from '../../lib/patient-practitioner-edge-api';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../../lib/supabase-wiring';

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
}[] = [
  {
    value: 'system',
    label: 'System',
    hint: 'Match your device light or dark mode.',
  },
  {
    value: 'light',
    label: 'Light',
    hint: 'Always use light appearance.',
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'Always use dark appearance.',
  },
];

type CaretakerGrantDto = {
  id: string;
  caretakerUserId: string;
  caretakerDisplayName: string | null;
  createdAt: string;
};

type CaretakerPendingInviteDto = {
  inviteeEmail: string;
  expiresAt: string;
  lastInviteSentAt: string | null;
  createdAt: string | null;
};

type PractitionerGrantDto = {
  id: string;
  practitionerUserId: string;
  practitionerEmail: string | null;
  practitionerDisplayName: string | null;
  createdAt: string;
};

type PractitionerPendingInviteDto = {
  inviteeEmail: string;
  expiresAt: string;
  lastInviteSentAt: string | null;
  createdAt: string | null;
};

const caretakerInputClassName = `min-h-[52px] rounded-lg px-3 py-2.5 text-base ${nw.input}`;

/**
 * User settings, account actions, and caretaker / practitioner access management for mobile.
 *
 * @returns Settings content.
 */
export function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, themePreference, setThemePreference } = useAppTheme();
  const patientCaretakerApiUrl = resolvePatientCaretakerAccessUrl();
  const patientPractitionerApiUrl = resolvePatientPractitionerAccessUrl();
  const isMountedRef = useRef(true);
  const [requireReauth, setRequireReauth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const powerSyncBridge = usePowerSyncBridgeState();
  const [powerSyncDiagBusy, setPowerSyncDiagBusy] = useState(false);
  const [caretakerGrant, setCaretakerGrant] = useState<
    CaretakerGrantDto | null | undefined
  >(undefined);
  const [caretakerPendingInvite, setCaretakerPendingInvite] =
    useState<CaretakerPendingInviteDto | null>(null);
  const [caretakerLoadError, setCaretakerLoadError] = useState<string | null>(
    null,
  );
  const [caretakerInviteSubmitting, setCaretakerInviteSubmitting] =
    useState(false);
  const [caretakerCancelInviteSubmitting, setCaretakerCancelInviteSubmitting] =
    useState(false);
  const [caretakerRevokeSubmitting, setCaretakerRevokeSubmitting] =
    useState(false);
  const [caretakerEmail, setCaretakerEmail] = useState('');
  const [caretakerFormError, setCaretakerFormError] = useState<string | null>(
    null,
  );

  const [practitionerGrants, setPractitionerGrants] = useState<
    PractitionerGrantDto[] | undefined
  >(undefined);
  const [practitionerPendingInvite, setPractitionerPendingInvite] =
    useState<PractitionerPendingInviteDto | null>(null);
  const [practitionerLoadError, setPractitionerLoadError] = useState<
    string | null
  >(null);
  const [practitionerInviteSubmitting, setPractitionerInviteSubmitting] =
    useState(false);
  const [practitionerResendSubmitting, setPractitionerResendSubmitting] =
    useState(false);
  const [
    practitionerCancelInviteSubmitting,
    setPractitionerCancelInviteSubmitting,
  ] = useState(false);
  const [practitionerRevokeSubmitting, setPractitionerRevokeSubmitting] =
    useState(false);
  const [practitionerEmail, setPractitionerEmail] = useState('');
  const [practitionerFormError, setPractitionerFormError] = useState<
    string | null
  >(null);

  const loadCaretakerGrant = useCallback(async () => {
    if (!patientCaretakerApiUrl) {
      return;
    }
    if (isMountedRef.current) {
      setCaretakerLoadError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            'Sign in with a network connection to manage caretaker access from this screen.',
          );
        }
        return;
      }
      const res = await fetchCaretakerAccessGet(session.access_token);
      if (res.status === 401) {
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            'Your session expired or is no longer valid. Sign in again to manage caretaker access.',
          );
        }
        return;
      }
      if (res.status === 403) {
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            'Caretaker linking is only available to patient accounts.',
          );
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            body.error === 'server_misconfigured'
              ? 'Caretaker access is temporarily unavailable (Supabase Edge Function or secrets).'
              : 'Unable to load caretaker access. Try again in a moment.',
          );
        }
        return;
      }
      const body = (await res.json()) as {
        grant: CaretakerGrantDto | null;
        pendingInvite?: CaretakerPendingInviteDto | null;
      };
      if (isMountedRef.current) {
        setCaretakerGrant(body.grant);
        setCaretakerPendingInvite(body.pendingInvite ?? null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setCaretakerGrant(null);
        setCaretakerPendingInvite(null);
        setCaretakerLoadError(
          isMissingPublishableKeyForCaretakerEdge(e)
            ? CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Unable to load caretaker access. Check your network connection.',
        );
      }
    }
  }, [patientCaretakerApiUrl]);

  const loadPractitionerGrants = useCallback(async () => {
    if (!patientPractitionerApiUrl) {
      return;
    }
    if (isMountedRef.current) {
      setPractitionerLoadError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setPractitionerGrants([]);
          setPractitionerPendingInvite(null);
          setPractitionerLoadError(
            'Sign in with a network connection to manage practitioner access from this screen.',
          );
        }
        return;
      }
      const res = await fetchPractitionerAccessGet(session.access_token);
      if (res.status === 401) {
        if (isMountedRef.current) {
          setPractitionerGrants([]);
          setPractitionerPendingInvite(null);
          setPractitionerLoadError(
            'Your session expired or is no longer valid. Sign in again to manage practitioner access.',
          );
        }
        return;
      }
      if (res.status === 403) {
        if (isMountedRef.current) {
          setPractitionerGrants([]);
          setPractitionerPendingInvite(null);
          setPractitionerLoadError(
            'Practitioner sharing is only available to patient accounts.',
          );
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (isMountedRef.current) {
          setPractitionerGrants([]);
          setPractitionerPendingInvite(null);
          setPractitionerLoadError(
            body.error === 'server_misconfigured'
              ? 'Practitioner access is temporarily unavailable (Supabase Edge Function or secrets).'
              : 'Unable to load practitioner access. Try again in a moment.',
          );
        }
        return;
      }
      const body = (await res.json()) as {
        grants?: PractitionerGrantDto[];
        pendingInvite?: PractitionerPendingInviteDto | null;
      };
      if (isMountedRef.current) {
        setPractitionerGrants(body.grants ?? []);
        setPractitionerPendingInvite(body.pendingInvite ?? null);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setPractitionerGrants([]);
        setPractitionerPendingInvite(null);
        setPractitionerLoadError(
          isMissingPublishableKeyForPractitionerEdge(e)
            ? PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Unable to load practitioner access. Check your network connection.',
        );
      }
    }
  }, [patientPractitionerApiUrl]);

  useEffect(() => {
    if (!patientCaretakerApiUrl) {
      if (isMountedRef.current) {
        setCaretakerGrant(null);
        setCaretakerPendingInvite(null);
        setCaretakerLoadError(null);
        setCaretakerFormError(null);
      }
      return;
    }
    void loadCaretakerGrant();
  }, [patientCaretakerApiUrl, loadCaretakerGrant]);

  useEffect(() => {
    if (!patientPractitionerApiUrl) {
      if (isMountedRef.current) {
        setPractitionerGrants([]);
        setPractitionerPendingInvite(null);
        setPractitionerLoadError(null);
        setPractitionerFormError(null);
      }
      return;
    }
    void loadPractitionerGrants();
  }, [patientPractitionerApiUrl, loadPractitionerGrants]);

  const onCancelPendingCaretakerInvite = async () => {
    if (isMountedRef.current) {
      setCaretakerCancelInviteSubmitting(true);
      setCaretakerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setCaretakerFormError(
            'You must be signed in with a valid session to cancel an invite.',
          );
        }
        return;
      }
      const res = await fetchCaretakerAccessCancelPendingInvite(
        session.access_token,
      );
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to cancel the invite.';
        if (isMountedRef.current) {
          setCaretakerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        announce('Pending caretaker invite cancelled.', {
          politeness: 'polite',
        });
      }
      await loadCaretakerGrant();
    } catch (e) {
      if (isMountedRef.current) {
        setCaretakerFormError(
          isMissingPublishableKeyForCaretakerEdge(e)
            ? CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setCaretakerCancelInviteSubmitting(false);
      }
    }
  };

  const onInviteCaretaker = async () => {
    const trimmed = caretakerEmail.trim();
    if (!trimmed) {
      if (isMountedRef.current) {
        setCaretakerFormError('Enter the caretaker email address.');
      }
      return;
    }
    if (isMountedRef.current) {
      setCaretakerInviteSubmitting(true);
      setCaretakerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setCaretakerFormError(
            'You must be signed in with a valid session to invite or link a caretaker.',
          );
        }
        return;
      }
      const res = await fetchCaretakerAccessPost(session.access_token, trimmed);
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
        outcome?: string;
        retryAfterSeconds?: number;
      };
      if (!res.ok) {
        const msg =
          res.status === 429 &&
          typeof maybe.retryAfterSeconds === 'number' &&
          Number.isFinite(maybe.retryAfterSeconds)
            ? `Please wait about ${Math.max(1, Math.round(maybe.retryAfterSeconds))} seconds before resending the invite.`
            : typeof maybe.error === 'string'
              ? maybe.error
              : 'Unable to invite or link caretaker access.';
        if (isMountedRef.current) {
          setCaretakerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        setCaretakerEmail('');
        if (maybe.outcome === 'invite_sent') {
          announce(
            'Invite email sent. The link in that message finishes caretaker setup in the mobile app or on user web.',
            { politeness: 'polite' },
          );
        } else if (maybe.outcome === 'already_linked') {
          announce('That caretaker is already linked to your account.', {
            politeness: 'polite',
          });
        } else {
          announce(
            'Caretaker linked. The caretaker can sign in on another device to help log for you.',
            { politeness: 'polite' },
          );
        }
      }
      await loadCaretakerGrant();
    } catch (e) {
      if (isMountedRef.current) {
        setCaretakerFormError(
          isMissingPublishableKeyForCaretakerEdge(e)
            ? CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setCaretakerInviteSubmitting(false);
      }
    }
  };

  const runRevokeCaretaker = async () => {
    if (isMountedRef.current) {
      setCaretakerRevokeSubmitting(true);
      setCaretakerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setCaretakerFormError(
            'You must be signed in with a valid session to revoke caretaker access.',
          );
        }
        return;
      }
      const res = await fetchCaretakerAccessDelete(session.access_token);
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to revoke caretaker access.';
        if (isMountedRef.current) {
          setCaretakerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        announce('Caretaker access revoked.', { politeness: 'polite' });
      }
      await loadCaretakerGrant();
    } catch (e) {
      if (isMountedRef.current) {
        setCaretakerFormError(
          isMissingPublishableKeyForCaretakerEdge(e)
            ? CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setCaretakerRevokeSubmitting(false);
      }
    }
  };

  const onConfirmRevokeCaretaker = () => {
    Alert.alert(
      'Revoke caretaker access?',
      'The caretaker will no longer be able to read or log your health data. Nothing already saved is deleted. You can link a caretaker again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke access',
          style: 'destructive',
          onPress: () => void runRevokeCaretaker(),
        },
      ],
    );
  };

  const onInvitePractitioner = async () => {
    const trimmed = practitionerEmail.trim();
    if (!trimmed) {
      if (isMountedRef.current) {
        setPractitionerFormError('Enter the practitioner email address.');
      }
      return;
    }
    if (isMountedRef.current) {
      setPractitionerInviteSubmitting(true);
      setPractitionerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setPractitionerFormError(
            'You must be signed in with a valid session to invite a practitioner.',
          );
        }
        return;
      }
      const res = await fetchPractitionerAccessPostInvite(
        session.access_token,
        trimmed,
      );
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
        outcome?: string;
        retryAfterSeconds?: number;
      };
      if (!res.ok) {
        const msg =
          res.status === 429 &&
          typeof maybe.retryAfterSeconds === 'number' &&
          Number.isFinite(maybe.retryAfterSeconds)
            ? `Please wait about ${Math.max(1, Math.round(maybe.retryAfterSeconds))} seconds before sending another invite.`
            : typeof maybe.error === 'string'
              ? maybe.error
              : 'Unable to invite or link practitioner access.';
        if (isMountedRef.current) {
          setPractitionerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        setPractitionerEmail('');
        const o = maybe.outcome;
        if (o === 'invite_sent') {
          announce(
            'Invite sent. They should open the email link in the practitioner web app and accept the invite before they appear under active practitioners.',
            { politeness: 'polite' },
          );
        } else if (o === 'already_linked') {
          announce('That practitioner is already linked.', {
            politeness: 'polite',
          });
        } else {
          announce('Practitioner linked.', { politeness: 'polite' });
        }
      }
      await loadPractitionerGrants();
    } catch (e) {
      if (isMountedRef.current) {
        setPractitionerFormError(
          isMissingPublishableKeyForPractitionerEdge(e)
            ? PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setPractitionerInviteSubmitting(false);
      }
    }
  };

  const onResendPractitionerInvite = async (email: string) => {
    if (isMountedRef.current) {
      setPractitionerResendSubmitting(true);
      setPractitionerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setPractitionerFormError(
            'You must be signed in with a valid session to resend an invite.',
          );
        }
        return;
      }
      const res = await fetchPractitionerAccessResendInvite(
        session.access_token,
        email.trim(),
      );
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
        retryAfterSeconds?: number;
        outcome?: string;
        message?: string;
      };
      if (!res.ok) {
        const msg =
          res.status === 429 &&
          typeof maybe.retryAfterSeconds === 'number' &&
          Number.isFinite(maybe.retryAfterSeconds)
            ? `Please wait about ${Math.max(1, Math.round(maybe.retryAfterSeconds))} seconds before resending the invite.`
            : typeof maybe.error === 'string'
              ? maybe.error
              : 'Unable to resend the invite.';
        if (isMountedRef.current) {
          setPractitionerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        if (maybe.outcome === 'invite_not_needed') {
          const polite =
            typeof maybe.message === 'string' && maybe.message.trim() !== ''
              ? maybe.message.trim()
              : 'That practitioner already has an account. They can sign in on the practitioner app.';
          announce(polite, { politeness: 'polite' });
        } else {
          announce('Invite email resent.', { politeness: 'polite' });
        }
        void loadPractitionerGrants();
      }
    } catch (e) {
      if (isMountedRef.current) {
        setPractitionerFormError(
          isMissingPublishableKeyForPractitionerEdge(e)
            ? PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setPractitionerResendSubmitting(false);
      }
    }
  };

  const onCancelPractitionerPendingInvite = async () => {
    if (isMountedRef.current) {
      setPractitionerCancelInviteSubmitting(true);
      setPractitionerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setPractitionerFormError(
            'You must be signed in with a valid session to cancel a pending invite.',
          );
        }
        return;
      }
      const res = await fetchPractitionerAccessCancelPendingInvite(
        session.access_token,
      );
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to cancel the pending invite.';
        if (isMountedRef.current) {
          setPractitionerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        announce('Pending practitioner invite cancelled.', {
          politeness: 'polite',
        });
        void loadPractitionerGrants();
      }
    } catch (e) {
      if (isMountedRef.current) {
        setPractitionerFormError(
          isMissingPublishableKeyForPractitionerEdge(e)
            ? PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setPractitionerCancelInviteSubmitting(false);
      }
    }
  };

  const runRevokePractitioner = async (practitionerUserId: string) => {
    if (isMountedRef.current) {
      setPractitionerRevokeSubmitting(true);
      setPractitionerFormError(null);
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setPractitionerFormError(
            'You must be signed in with a valid session to revoke practitioner access.',
          );
        }
        return;
      }
      const res = await fetchPractitionerAccessRevoke(
        session.access_token,
        practitionerUserId,
      );
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to revoke practitioner access.';
        if (isMountedRef.current) {
          setPractitionerFormError(msg);
          announce(msg, { politeness: 'assertive' });
        }
        return;
      }
      if (isMountedRef.current) {
        announce(
          'Practitioner access revoked. Future reads are blocked; data they already saw is not erased.',
          { politeness: 'polite' },
        );
      }
      await loadPractitionerGrants();
    } catch (e) {
      if (isMountedRef.current) {
        setPractitionerFormError(
          isMissingPublishableKeyForPractitionerEdge(e)
            ? PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP
            : 'Something went wrong. Try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setPractitionerRevokeSubmitting(false);
      }
    }
  };

  const onConfirmRevokePractitioner = (
    practitionerUserId: string,
    label: string,
  ) => {
    Alert.alert(
      'Revoke practitioner access?',
      `${label} will no longer be authorized to read your data on new requests. Nothing they may already have seen is erased. You can invite them again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke access',
          style: 'destructive',
          onPress: () => void runRevokePractitioner(practitionerUserId),
        },
      ],
    );
  };

  const onRunPowerSyncReplicaDiagnostics = useCallback(async () => {
    const db = powerSyncBridge.database;
    if (!db) {
      Alert.alert(
        'PowerSync replica',
        'No local database is open. Check that EXPO_PUBLIC_POWERSYNC_URL is set and you are signed in.',
      );
      return;
    }
    setPowerSyncDiagBusy(true);
    try {
      const result = await runPowerSyncReplicaDiagnostics(db);
      const body = formatPowerSyncReplicaDiagnosticsMessage(
        result,
        powerSyncBridge,
      );
      Alert.alert(
        result.ok ? 'PowerSync replica' : 'PowerSync replica (query failed)',
        body.length > 3500 ? `${body.slice(0, 3500)}\n…` : body,
      );
    } finally {
      setPowerSyncDiagBusy(false);
    }
  }, [powerSyncBridge]);

  useEffect(() => {
    isMountedRef.current = true;

    const loadPreference = async () => {
      try {
        const enabled = await getRequireReauthOnOpenPreference();

        if (isMountedRef.current) {
          setRequireReauth(enabled);
        }
      } catch {
        if (isMountedRef.current) {
          setErrorMessage('Unable to load your setting right now. Try again.');
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    void loadPreference();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onTogglePreference = async (nextValue: boolean) => {
    setSaving(true);
    setErrorMessage(null);

    try {
      await setRequireReauthOnOpenPreference(nextValue);

      if (isMountedRef.current) {
        setRequireReauth(nextValue);
      }
    } catch {
      if (isMountedRef.current) {
        setErrorMessage('Unable to save your setting right now. Try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  const onSelectTheme = async (next: ThemePreference) => {
    setThemeError(null);
    setThemeSaving(true);
    try {
      await setThemePreference(next);
    } catch {
      if (isMountedRef.current) {
        setThemeError('Unable to save your theme choice. Try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setThemeSaving(false);
      }
    }
  };

  const handleSignOut = async () => {
    const mobileSupabase = getMobileSupabaseClient();
    setSignOutBusy(true);
    setSignOutError(null);

    try {
      const { error } = await signOut(mobileSupabase);
      if (error) {
        setSignOutError(mapAuthError(error.message));
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected authentication error';
      setSignOutError(mapAuthError(message));
    } finally {
      setSignOutBusy(false);
    }
  };

  return (
    <ScreenShell contentAlign="stretch">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        showsVerticalScrollIndicator
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: Math.max(insets.bottom, 12) + 28,
        }}
      >
        <View className="gap-3">
          <Text className={`text-[22px] font-semibold ${nw.textInk}`}>
            Settings
          </Text>

          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Color theme"
            className="gap-2"
          >
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              Color theme
            </Text>
            <Text className={`text-base ${nw.textMuted}`}>
              Choose how ABStrack looks. System follows your device settings.
            </Text>
            {THEME_OPTIONS.map(({ value, label, hint }) => {
              const selected = themePreference === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: themeSaving }}
                  accessibilityLabel={label}
                  accessibilityHint={hint}
                  disabled={themeSaving}
                  onPress={() => void onSelectTheme(value)}
                  className={`min-h-[52px] justify-center rounded-xl border px-4 py-3 ${
                    selected
                      ? `border-2 border-app-primary bg-app-primary-soft dark:border-app-primary-dark dark:bg-app-primary-soft-dark ${nw.textInk}`
                      : `border border-app-border bg-app-surface dark:border-app-border-dark dark:bg-app-surface-dark ${nw.textInk}`
                  } ${themeSaving ? 'opacity-60' : ''}`}
                >
                  <Text className={`text-base font-semibold ${nw.textInk}`}>
                    {label}
                  </Text>
                  <Text className={`mt-0.5 text-sm ${nw.textMuted}`}>
                    {hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {themeError ? (
            <Text
              className={`text-sm ${nw.textError}`}
              accessibilityRole="alert"
            >
              {themeError}
            </Text>
          ) : null}

          <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Manage on episodes"
            onPress={() =>
              navigation.navigate('Manage', { initialSegment: 'episodes' })
            }
            className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark`}
          >
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              Manage episodes
            </Text>
            <Text className={`mt-0.5 text-sm ${nw.textMuted}`}>
              Open Manage to review episode history and resume an in-progress
              episode.
            </Text>
          </Pressable>

          <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

          <View className="gap-2" accessibilityLabel="Account">
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              Account
            </Text>
            <Text className={`text-base ${nw.textMuted}`}>
              Sign out of this device when you are finished.
            </Text>
            {signOutError ? (
              <Text
                className={`text-sm ${nw.textError}`}
                accessibilityRole="alert"
              >
                {signOutError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={signOutBusy ? 'Signing out...' : 'Sign out'}
              accessibilityState={{ disabled: signOutBusy }}
              disabled={signOutBusy}
              onPress={() => void handleSignOut()}
              className={`min-h-[52px] items-center justify-center rounded-xl px-4 ${nw.btnPrimary} ${signOutBusy ? 'opacity-60' : ''}`}
            >
              <Text
                className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
              >
                {signOutBusy ? 'Signing out...' : 'Sign out'}
              </Text>
            </Pressable>
          </View>

          <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

          <View className="gap-2" accessibilityLabel="Caretaker access">
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              Caretaker access
            </Text>
            <>
              <Text className={`text-base ${nw.textMuted}`}>
                A caretaker signs in with his or her own ABStrack account and
                uses the same logging flows as you, with matching data access,
                once the invite completes. Invite links open the ABStrack mobile
                app when tapped on a phone (mobile-first), and the same link
                completes caretaker sign-up on user web when opened in a
                browser. This is separate from a healthcare practitioner: the
                practitioner web app is read-only and does not replace you in
                patient flows.
              </Text>
              {!patientCaretakerApiUrl ? (
                <Text
                  className={`text-sm ${nw.textError}`}
                  accessibilityRole="alert"
                >
                  Missing EXPO_PUBLIC_SUPABASE_URL. Add it to apps/mobile/.env
                  so invite and revoke can call your Supabase project Edge
                  Function patient-caretaker-access (see repo
                  supabase/functions).
                </Text>
              ) : null}
              {patientCaretakerApiUrl && caretakerLoadError ? (
                <Text
                  className={`text-sm ${nw.textError}`}
                  accessibilityRole="alert"
                >
                  {caretakerLoadError}
                </Text>
              ) : null}
              {patientCaretakerApiUrl &&
              caretakerGrant === undefined &&
              !caretakerLoadError ? (
                <Text
                  className={`text-base ${nw.textMuted}`}
                  accessibilityLiveRegion="polite"
                >
                  Loading caretaker access…
                </Text>
              ) : null}
              {patientCaretakerApiUrl &&
              caretakerPendingInvite &&
              !caretakerGrant &&
              caretakerGrant !== undefined &&
              !caretakerLoadError ? (
                <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
                  <Text className={`text-base font-semibold ${nw.textInk}`}>
                    Invite pending
                  </Text>
                  <Text className={`text-sm ${nw.textMuted}`}>
                    We sent an email to {caretakerPendingInvite.inviteeEmail}.
                    The link in that message finishes setup in the mobile app or
                    on user web.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel pending caretaker invite"
                    accessibilityState={{
                      disabled: caretakerCancelInviteSubmitting,
                    }}
                    disabled={caretakerCancelInviteSubmitting}
                    onPress={() => void onCancelPendingCaretakerInvite()}
                    className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-bg px-4 py-3 shadow-soft dark:border-app-border-dark dark:bg-app-bg-dark dark:shadow-soft-dark ${caretakerCancelInviteSubmitting ? 'opacity-60' : ''}`}
                  >
                    <Text className={`text-base font-semibold ${nw.textInk}`}>
                      {caretakerCancelInviteSubmitting
                        ? 'Working…'
                        : 'Cancel pending invite'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {patientCaretakerApiUrl && caretakerGrant ? (
                <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
                  <Text className={`text-base font-semibold ${nw.textInk}`}>
                    Active caretaker
                  </Text>
                  <Text className={`text-sm ${nw.textMuted}`}>
                    You can have one active caretaker. Access stays in place
                    until you revoke below.
                  </Text>
                  <Text
                    className={`text-base ${nw.textInk}`}
                    accessibilityLabel={`Caretaker display name: ${
                      caretakerGrant.caretakerDisplayName?.trim() ||
                      'Not set on the caretaker profile'
                    }`}
                  >
                    {caretakerGrant.caretakerDisplayName?.trim()
                      ? caretakerGrant.caretakerDisplayName
                      : 'No display name on the caretaker profile'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Revoke caretaker access"
                    accessibilityHint="Opens a confirmation before removing access"
                    accessibilityState={{ disabled: caretakerRevokeSubmitting }}
                    disabled={caretakerRevokeSubmitting}
                    onPress={onConfirmRevokeCaretaker}
                    className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-bg px-4 py-3 shadow-soft dark:border-app-border-dark dark:bg-app-bg-dark dark:shadow-soft-dark ${caretakerRevokeSubmitting ? 'opacity-60' : ''}`}
                  >
                    <Text className={`text-base font-semibold ${nw.textError}`}>
                      {caretakerRevokeSubmitting
                        ? 'Working…'
                        : 'Revoke caretaker access'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {patientCaretakerApiUrl &&
              !caretakerPendingInvite &&
              !caretakerGrant &&
              caretakerGrant !== undefined &&
              !caretakerLoadError ? (
                <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
                  <Text className={`text-base font-semibold ${nw.textInk}`}>
                    Invite or link a caretaker
                  </Text>
                  <Text className={`text-sm ${nw.textMuted}`}>
                    Enter your support person's email, and we will send an
                    invite.
                  </Text>
                  <TextInput
                    accessibilityLabel="Caretaker email"
                    accessibilityHint="Caretaker sign-up email address"
                    value={caretakerEmail}
                    onChangeText={setCaretakerEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!caretakerInviteSubmitting}
                    placeholder="caretaker@example.com"
                    className={caretakerInputClassName}
                  />
                  {caretakerFormError ? (
                    <Text
                      className={`text-sm ${nw.textError}`}
                      accessibilityRole="alert"
                    >
                      {caretakerFormError}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send caretaker invite or link"
                    accessibilityState={{ disabled: caretakerInviteSubmitting }}
                    disabled={caretakerInviteSubmitting}
                    onPress={() => void onInviteCaretaker()}
                    className={`min-h-[52px] justify-center rounded-xl ${nw.btnPrimary} px-4 py-3 ${caretakerInviteSubmitting ? 'opacity-60' : ''}`}
                  >
                    <Text
                      className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
                    >
                      {caretakerInviteSubmitting
                        ? 'Sending…'
                        : 'Send invite or link'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          </View>

          <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

          <View className="gap-2" accessibilityLabel="Practitioner access">
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              Practitioner access
            </Text>
            <Text className={`text-base ${nw.textMuted}`}>
              Invite a healthcare practitioner by email. They accept the invite
              on the ABStrack practitioner web app (not this mobile app),
              usually via the email link. They can read your data while access
              stays active. Two-factor authentication is required only if they
              set a password for email sign-in; magic-link sign-in alone does
              not require it. Revoking stops future reads; it does not erase
              what they may already have viewed.
            </Text>
            {!patientPractitionerApiUrl ? (
              <Text
                className={`text-sm ${nw.textError}`}
                accessibilityRole="alert"
              >
                Missing EXPO_PUBLIC_SUPABASE_URL. Add it to apps/mobile/.env so
                practitioner invite and revoke can call your Supabase Edge
                Function patient-practitioner-access (see repo
                supabase/functions).
              </Text>
            ) : null}
            {patientPractitionerApiUrl && practitionerLoadError ? (
              <Text
                className={`text-sm ${nw.textError}`}
                accessibilityRole="alert"
              >
                {practitionerLoadError}
              </Text>
            ) : null}
            {patientPractitionerApiUrl &&
            practitionerGrants === undefined &&
            !practitionerLoadError ? (
              <Text
                className={`text-base ${nw.textMuted}`}
                accessibilityLiveRegion="polite"
              >
                Loading practitioner access…
              </Text>
            ) : null}
            {patientPractitionerApiUrl &&
            practitionerPendingInvite &&
            practitionerGrants !== undefined &&
            !practitionerLoadError ? (
              <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
                <Text className={`text-base font-semibold ${nw.textInk}`}>
                  Practitioner invite pending
                </Text>
                <Text className={`text-sm ${nw.textMuted}`}>
                  We sent an email to {practitionerPendingInvite.inviteeEmail}.
                  They must open that link in the practitioner web app and
                  accept the invite before they are listed under active
                  practitioners.
                </Text>
                <View className="gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Resend practitioner invite email"
                    accessibilityState={{
                      disabled: practitionerResendSubmitting,
                    }}
                    disabled={practitionerResendSubmitting}
                    onPress={() =>
                      void onResendPractitionerInvite(
                        practitionerPendingInvite.inviteeEmail,
                      )
                    }
                    className={`min-h-[48px] justify-center rounded-xl border border-app-border bg-app-surface px-3 py-2 dark:border-app-border-dark dark:bg-app-surface-dark ${practitionerResendSubmitting ? 'opacity-60' : ''}`}
                  >
                    <Text
                      className={`text-center text-sm font-semibold ${nw.textInk}`}
                    >
                      {practitionerResendSubmitting
                        ? 'Working…'
                        : 'Resend invite email'}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel pending practitioner invite"
                    accessibilityState={{
                      disabled: practitionerCancelInviteSubmitting,
                    }}
                    disabled={practitionerCancelInviteSubmitting}
                    onPress={() => void onCancelPractitionerPendingInvite()}
                    className={`min-h-[48px] justify-center rounded-xl border border-app-border bg-app-bg px-3 py-2 dark:border-app-border-dark dark:bg-app-bg-dark ${practitionerCancelInviteSubmitting ? 'opacity-60' : ''}`}
                  >
                    <Text
                      className={`text-center text-sm font-semibold ${nw.textInk}`}
                    >
                      {practitionerCancelInviteSubmitting
                        ? 'Working…'
                        : 'Cancel pending invite'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {patientPractitionerApiUrl &&
            (practitionerGrants?.length ?? 0) > 0 &&
            !practitionerLoadError ? (
              <View className={`gap-3 ${nw.card} rounded-xl border p-4`}>
                <Text className={`text-base font-semibold ${nw.textInk}`}>
                  Active practitioners
                </Text>
                {practitionerGrants?.map((g) => {
                  const label =
                    g.practitionerEmail?.trim() ||
                    g.practitionerDisplayName?.trim() ||
                    'Practitioner account';
                  return (
                    <View
                      key={g.id}
                      className="gap-2 rounded-lg border border-app-border bg-app-bg p-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                    >
                      <Text className={`text-base font-medium ${nw.textInk}`}>
                        {label}
                      </Text>
                      {g.practitionerEmail?.trim() ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Resend practitioner invite email"
                          accessibilityState={{
                            disabled: practitionerResendSubmitting,
                          }}
                          disabled={practitionerResendSubmitting}
                          onPress={() =>
                            void onResendPractitionerInvite(
                              g.practitionerEmail ?? '',
                            )
                          }
                          className={`min-h-[48px] justify-center rounded-xl border border-app-border bg-app-surface px-3 py-2 dark:border-app-border-dark dark:bg-app-surface-dark ${practitionerResendSubmitting ? 'opacity-60' : ''}`}
                        >
                          <Text
                            className={`text-center text-sm font-semibold ${nw.textInk}`}
                          >
                            {practitionerResendSubmitting
                              ? 'Working…'
                              : 'Resend invite email'}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Revoke practitioner access for ${label}`}
                        accessibilityState={{
                          disabled: practitionerRevokeSubmitting,
                        }}
                        disabled={practitionerRevokeSubmitting}
                        onPress={() =>
                          onConfirmRevokePractitioner(
                            g.practitionerUserId,
                            label,
                          )
                        }
                        className={`min-h-[48px] justify-center rounded-xl border border-app-border bg-app-bg px-3 py-2 dark:border-app-border-dark dark:bg-app-bg-dark ${practitionerRevokeSubmitting ? 'opacity-60' : ''}`}
                      >
                        <Text
                          className={`text-center text-sm font-semibold ${nw.textError}`}
                        >
                          {practitionerRevokeSubmitting
                            ? 'Working…'
                            : 'Revoke access'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {patientPractitionerApiUrl &&
            !practitionerLoadError &&
            practitionerGrants !== undefined &&
            !practitionerPendingInvite ? (
              <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
                <Text className={`text-base font-semibold ${nw.textInk}`}>
                  Invite a practitioner
                </Text>
                <Text className={`text-sm ${nw.textMuted}`}>
                  Enter their work email. If they already have a practitioner
                  account, access links immediately.
                </Text>
                <TextInput
                  accessibilityLabel="Practitioner email"
                  accessibilityHint="Healthcare practitioner email for ABStrack practitioner app"
                  value={practitionerEmail}
                  onChangeText={setPractitionerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!practitionerInviteSubmitting}
                  placeholder="clinician@hospital.example.com"
                  className={caretakerInputClassName}
                />
                {practitionerFormError ? (
                  <Text
                    className={`text-sm ${nw.textError}`}
                    accessibilityRole="alert"
                  >
                    {practitionerFormError}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send practitioner invite or link"
                  accessibilityState={{
                    disabled: practitionerInviteSubmitting,
                  }}
                  disabled={practitionerInviteSubmitting}
                  onPress={() => void onInvitePractitioner()}
                  className={`min-h-[52px] justify-center rounded-xl ${nw.btnPrimary} px-4 py-3 ${practitionerInviteSubmitting ? 'opacity-60' : ''}`}
                >
                  <Text
                    className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
                  >
                    {practitionerInviteSubmitting
                      ? 'Sending…'
                      : 'Send invite or link'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {isPowerSyncReplicaDiagnosticsEnabled() ? (
            <>
              <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />
              <View className="gap-2">
                <Text className={`text-base font-semibold ${nw.textInk}`}>
                  PowerSync replica (debug)
                </Text>
                <Text className={`text-base ${nw.textMuted}`}>
                  Counts rows in the encrypted local replica. If decryption
                  fails, you will see a query error instead of numbers. Does not
                  log the encryption key. Filter logcat with
                  PowerSyncReplicaDiag.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Run PowerSync replica diagnostics"
                  accessibilityState={{ disabled: powerSyncDiagBusy }}
                  disabled={powerSyncDiagBusy}
                  onPress={() => void onRunPowerSyncReplicaDiagnostics()}
                  className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark ${powerSyncDiagBusy ? 'opacity-60' : ''}`}
                >
                  <Text className={`text-base font-semibold ${nw.textInk}`}>
                    {powerSyncDiagBusy ? 'Running…' : 'Run replica diagnostics'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}

          <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

          <View className="flex-row items-center gap-3">
            <View className="min-w-0 flex-1 gap-1.5">
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                Require re-authentication on app open
              </Text>
              <Text className={`text-base ${nw.textMuted}`}>
                When enabled, you will be asked to log in every time you reopen
                the app.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Require re-authentication on app open"
              testID="require-reauth-switch"
              value={requireReauth}
              onValueChange={onTogglePreference}
              disabled={loading || saving}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          {errorMessage ? (
            <Text
              className={`text-sm ${nw.textError}`}
              accessibilityRole="alert"
            >
              {errorMessage}
            </Text>
          ) : null}
          {loading ? (
            <Text className={`text-base ${nw.textMuted}`}>
              Loading setting...
            </Text>
          ) : null}
          {saving ? (
            <Text className={`text-base ${nw.textMuted}`}>
              Saving setting...
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}
