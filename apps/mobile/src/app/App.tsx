import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@abstrack/supabase';
import { fetchMobileDeviceIsConnected } from '../lib/network/mobile-device-netinfo';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../lib/supabase-wiring';
import { AppProviders } from './components/AppProviders';
import { SyncHealthFooter } from './components/SyncHealthFooter';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { MainTabNavigator } from './navigation/MainTabNavigator';
import type { MainStackParamList } from './navigation/types';
import { LoginScreen } from './screens/LoginScreen';
import { EpisodeStartScreen } from './screens/EpisodeStartScreen';
import { FoodDiaryEntryScreen } from './screens/FoodDiaryEntryScreen';
import { StandaloneHealthMarkersScreen } from './screens/StandaloneHealthMarkersScreen';
import { HealthMarkerPromptScreen } from './screens/HealthMarkerPromptScreen';
import { SymptomPromptScreen } from './screens/SymptomPromptScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SignupScreen } from './screens/SignupScreen';
import { UpdatePasswordScreen } from './screens/UpdatePasswordScreen';
import {
  PowerSyncSessionBridge,
  usePowerSyncBridgeState,
} from '../lib/powersync/PowerSyncSessionBridge';
import { getRequireReauthOnOpenPreference } from './reauth-preference';
import { useAppTheme } from './theme/AppThemeContext';
import { nw } from './theme/app-nativewind-classes';

type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  UpdatePassword: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

type AuthRoute = keyof AuthStackParamList;

/**
 * When sign-out replica wipe fails, the PowerSync bridge sets `syncError` but
 * `SyncHealthFooter` is not mounted on the auth stack — surface the message here.
 *
 * @param props.session - Current session; banner hidden while any session exists.
 */
function SignOutReplicaCleanupBanner({ session }: { session: Session | null }) {
  const { syncError } = usePowerSyncBridgeState();
  if (session || !syncError) {
    return null;
  }
  return (
    <View
      accessibilityRole="alert"
      className={`border-b border-app-health-failure-border bg-app-health-failure-bg px-4 py-3 dark:border-app-health-failure-border-dark dark:bg-app-health-failure-bg-dark`}
    >
      <Text
        className={`${nw.healthFailureBody} text-sm`}
        accessibilityLabel={syncError.message}
      >
        {syncError.message}
      </Text>
    </View>
  );
}

function parseDeepLink(url: string): {
  params: URLSearchParams;
  pathname: string;
  hostname: string;
} {
  try {
    const parsedUrl = new URL(url);
    const params = new URLSearchParams(parsedUrl.search);
    const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));

    hashParams.forEach((value, key) => {
      params.set(key, value);
    });

    return {
      params,
      pathname: parsedUrl.pathname,
      hostname: parsedUrl.hostname,
    };
  } catch {
    return {
      params: new URLSearchParams(),
      pathname: '',
      hostname: '',
    };
  }
}

function isRecoveryTargetPath(pathname: string, hostname: string): boolean {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  return (
    normalizedPath === '/update-password' || hostname === 'update-password'
  );
}

function getRecoveryErrorMessage(params: URLSearchParams): string | null {
  const providerError = params.get('error_description') ?? params.get('error');
  if (providerError) {
    return 'This reset link is invalid or expired. Request a new one.';
  }

  return null;
}

/**
 * Root component: session bootstrap and navigation. Theme follows system appearance by default.
 *
 * @returns Application tree.
 */
export function App() {
  return (
    <AppProviders>
      <AppBootstrap />
    </AppProviders>
  );
}

function AppBootstrap() {
  const { colors, navigationTheme, statusBarStyle } = useAppTheme();
  const mobileSupabase = useMemo(() => getMobileSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authRoute, setAuthRoute] = useState<AuthRoute>('Login');
  const [recoveryFlowActive, setRecoveryFlowActive] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryFlowActiveRef = useRef(false);
  const authRouteRef = useRef<AuthRoute>('Login');
  /** Coalesces foreground `refreshSession` bursts (auto-refresh + resume) to reduce LogBox noise. */
  const resumeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const resumeRefreshInFlightRef = useRef(false);
  /** Prevents resume handler `setInitializing(false)` from racing cold start `bootstrap` `finally`. */
  const bootstrapCompleteRef = useRef(false);

  const stackScreenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.primary,
      headerTitleStyle: { color: colors.ink, fontWeight: '600' as const },
      contentStyle: { backgroundColor: colors.bg },
    }),
    [colors],
  );

  useEffect(() => {
    let mounted = true;

    const isRecoveryFlowInProgress = () =>
      recoveryFlowActiveRef.current ||
      authRouteRef.current === 'UpdatePassword';

    const enforceReauthIfNeeded = async (options?: {
      /**
       * When false (offline / unknown reachability), still enforce re-auth privacy with
       * `signOut({ scope: 'local' })` so the session is cleared on-device without a network round
       * trip. When true, uses the default sign-out (server + local) after a confident online read.
       */
      allowServerSignOut?: boolean;
    }) => {
      const allowServerSignOut = options?.allowServerSignOut ?? true;
      try {
        if (isRecoveryFlowInProgress()) {
          return;
        }

        const reauthRequired = await getRequireReauthOnOpenPreference();

        if (!reauthRequired) {
          return;
        }

        if (isRecoveryFlowInProgress()) {
          return;
        }

        const {
          data: { session: currentSession },
          error: getSessionError,
        } = await getMobileAuthSessionSafe();

        if (getSessionError) {
          console.warn(
            'Unable to check current session before enforcing re-auth.',
            getSessionError,
          );
          return;
        }

        if (!currentSession) {
          return;
        }

        const { error: signOutError } = allowServerSignOut
          ? await mobileSupabase.auth.signOut()
          : await mobileSupabase.auth.signOut({ scope: 'local' });

        if (signOutError) {
          console.warn(
            allowServerSignOut
              ? 'Unable to sign out while enforcing re-auth preference.'
              : 'Unable to sign out locally while enforcing re-auth preference.',
            signOutError,
          );
        }
      } catch (error) {
        console.warn(
          'Skipping re-auth enforcement because session checks failed.',
          error,
        );
      }
    };

    const handleRecoveryLink = async (url: string) => {
      const { params, pathname, hostname } = parseDeepLink(url);
      const code = params.get('code');
      const type = params.get('type');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const providerError = getRecoveryErrorMessage(params);
      const isRecoveryType = type === 'recovery';
      const hasRecoveryCredentials =
        Boolean(code) || (Boolean(accessToken) && Boolean(refreshToken));
      const hasRecoveryPayload =
        isRecoveryType &&
        isRecoveryTargetPath(pathname, hostname) &&
        (hasRecoveryCredentials || Boolean(providerError));

      if (!hasRecoveryPayload || !mounted) {
        return;
      }

      recoveryFlowActiveRef.current = true;
      authRouteRef.current = 'UpdatePassword';
      setRecoveryFlowActive(true);
      setAuthRoute('UpdatePassword');

      if (providerError) {
        setRecoveryError(providerError);
        return;
      }

      if (code) {
        const { error } =
          await mobileSupabase.auth.exchangeCodeForSession(code);
        if (error) {
          setRecoveryError(
            'This reset link is invalid or expired. Request a new one.',
          );
        } else {
          setRecoveryError(null);
        }
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await mobileSupabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          setRecoveryError(
            'This reset link is invalid or expired. Request a new one.',
          );
        } else {
          setRecoveryError(null);
        }
        return;
      }

      setRecoveryError(
        'This reset link is invalid or expired. Request a new one.',
      );
    };

    const bootstrap = async () => {
      try {
        // Prime session read in parallel with deep link; do not `setSession` until after
        // `enforceReauthIfNeeded` so PowerSync never opens the replica for a session we will clear.
        const [, initialUrl] = await Promise.all([
          getMobileAuthSessionSafe(),
          Linking.getInitialURL(),
        ]);

        if (initialUrl) {
          await handleRecoveryLink(initialUrl);
        }

        const connectedAtBoot = await fetchMobileDeviceIsConnected();
        await enforceReauthIfNeeded({
          allowServerSignOut: connectedAtBoot === true,
        });

        const { data: afterReauth } = await getMobileAuthSessionSafe();
        if (mounted) {
          setSession(afterReauth.session ?? null);
        }
      } catch (error) {
        /* Hermes LogBox: do not rethrow; still leave bootstrap so the UI is not stuck loading. */
        if (__DEV__) {
          console.warn('[AppBootstrap] Startup failed', error);
        }
      } finally {
        bootstrapCompleteRef.current = true;
        if (mounted) {
          setInitializing(false);
        }
      }
    };

    void bootstrap();

    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleRecoveryLink(url).catch(() => {
        /* Deep link handling must not reject unhandled */
      });
    });

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState !== 'active') {
          return;
        }
        void (async () => {
          try {
            const connected = await fetchMobileDeviceIsConnected();
            await enforceReauthIfNeeded({
              allowServerSignOut: connected === true,
            });
            if (connected !== true) {
              return;
            }
            if (resumeRefreshTimerRef.current !== null) {
              clearTimeout(resumeRefreshTimerRef.current);
            }
            resumeRefreshTimerRef.current = setTimeout(() => {
              resumeRefreshTimerRef.current = null;
              if (resumeRefreshInFlightRef.current) {
                return;
              }
              const refresh = mobileSupabase.auth.refreshSession;
              if (typeof refresh !== 'function') {
                return;
              }
              resumeRefreshInFlightRef.current = true;
              void refresh
                .call(mobileSupabase.auth)
                .catch(() => undefined)
                .finally(() => {
                  resumeRefreshInFlightRef.current = false;
                });
            }, 400);
          } finally {
            if (mounted && bootstrapCompleteRef.current) {
              setInitializing(false);
            }
          }
        })();
      },
    );

    const {
      data: { subscription },
    } = mobileSupabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        authRouteRef.current = 'Login';
        recoveryFlowActiveRef.current = false;
        setAuthRoute('Login');
        setRecoveryFlowActive(false);
        setRecoveryError(null);
      }

      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED'
      ) {
        setSession(nextSession ?? null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      urlSubscription?.remove?.();
      appStateSubscription?.remove?.();
      if (resumeRefreshTimerRef.current !== null) {
        clearTimeout(resumeRefreshTimerRef.current);
        resumeRefreshTimerRef.current = null;
      }
    };
  }, [mobileSupabase]);

  const authStack = useMemo(
    () => (
      <AuthStack.Navigator screenOptions={stackScreenOptions}>
        {authRoute === 'Login' ? (
          <AuthStack.Screen name="Login" options={{ title: 'Login' }}>
            {() => (
              <LoginScreen
                onGoToSignup={() => setAuthRoute('Signup')}
                onGoToForgotPassword={() => setAuthRoute('ForgotPassword')}
              />
            )}
          </AuthStack.Screen>
        ) : null}

        {authRoute === 'Signup' ? (
          <AuthStack.Screen name="Signup" options={{ title: 'Sign up' }}>
            {() => <SignupScreen onGoToLogin={() => setAuthRoute('Login')} />}
          </AuthStack.Screen>
        ) : null}

        {authRoute === 'ForgotPassword' ? (
          <AuthStack.Screen
            name="ForgotPassword"
            options={{ title: 'Forgot password' }}
          >
            {() => (
              <ForgotPasswordScreen onGoToLogin={() => setAuthRoute('Login')} />
            )}
          </AuthStack.Screen>
        ) : null}

        {authRoute === 'UpdatePassword' ? (
          <AuthStack.Screen
            name="UpdatePassword"
            options={{ title: 'Set new password' }}
          >
            {() => (
              <UpdatePasswordScreen
                recoveryError={recoveryError}
                onGoToLogin={() => {
                  authRouteRef.current = 'Login';
                  recoveryFlowActiveRef.current = false;
                  setRecoveryFlowActive(false);
                  setRecoveryError(null);
                  setAuthRoute('Login');
                }}
                onPasswordUpdated={() => {
                  authRouteRef.current = 'Login';
                  recoveryFlowActiveRef.current = false;
                  setRecoveryFlowActive(false);
                  setRecoveryError(null);
                  setAuthRoute('Login');
                }}
              />
            )}
          </AuthStack.Screen>
        ) : null}
      </AuthStack.Navigator>
    ),
    [authRoute, recoveryError, stackScreenOptions],
  );

  const showAuthStack = !session || recoveryFlowActive;

  if (initializing) {
    return (
      <PowerSyncSessionBridge session={session}>
        <View className={`flex-1 ${nw.screenBg}`}>
          <StatusBar style={statusBarStyle} />
          <SafeAreaView
            className={`flex-1 items-center justify-center ${nw.screenBg}`}
          >
            <ActivityIndicator size="large" color={colors.primary} />
          </SafeAreaView>
        </View>
      </PowerSyncSessionBridge>
    );
  }

  return (
    <PowerSyncSessionBridge session={session}>
      <View className={`flex-1 ${nw.screenBg}`}>
        <StatusBar style={statusBarStyle} />
        <View className="min-h-0 flex-1">
          <NavigationContainer theme={navigationTheme}>
            {showAuthStack ? (
              <>
                <SignOutReplicaCleanupBanner session={session} />
                {authStack}
              </>
            ) : (
              <MainStack.Navigator screenOptions={stackScreenOptions}>
                <MainStack.Screen
                  name="MainTabs"
                  component={MainTabNavigator}
                  options={{ headerShown: false }}
                />
                <MainStack.Screen
                  name="EpisodeStart"
                  component={EpisodeStartScreen}
                  options={{
                    title: '',
                    headerBackTitle: 'Home',
                  }}
                />
                <MainStack.Screen
                  name="SymptomPrompt"
                  component={SymptomPromptScreen}
                  options={{
                    title: 'Symptoms',
                    headerBackTitle: 'Home',
                  }}
                />
                <MainStack.Screen
                  name="HealthMarkerPrompt"
                  component={HealthMarkerPromptScreen}
                  options={{
                    title: 'Health markers',
                    headerBackTitle: 'Home',
                  }}
                />
                <MainStack.Screen
                  name="FoodDiaryEntry"
                  component={FoodDiaryEntryScreen}
                  options={{
                    title: 'Food diary',
                    headerBackTitle: 'Home',
                  }}
                />
                <MainStack.Screen
                  name="StandaloneHealthMarkers"
                  component={StandaloneHealthMarkersScreen}
                  options={{
                    title: 'Health markers',
                    headerBackTitle: 'Home',
                  }}
                />
                <MainStack.Screen
                  name="Settings"
                  component={SettingsScreen}
                  options={{ title: 'Settings' }}
                />
              </MainStack.Navigator>
            )}
          </NavigationContainer>
        </View>
        {!showAuthStack ? <SyncHealthFooter /> : null}
      </View>
    </PowerSyncSessionBridge>
  );
}

export default App;
