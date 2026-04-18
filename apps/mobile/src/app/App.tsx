import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../lib/supabase-wiring';
import { AppProviders } from './components/AppProviders';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { MainTabNavigator } from './navigation/MainTabNavigator';
import type { MainStackParamList } from './navigation/types';
import { LoginScreen } from './screens/LoginScreen';
import { EpisodeStartScreen } from './screens/EpisodeStartScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SignupScreen } from './screens/SignupScreen';
import { UpdatePasswordScreen } from './screens/UpdatePasswordScreen';
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

    const enforceReauthIfNeeded = async () => {
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
        } = await mobileSupabase.auth.getSession();

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

        const { error: signOutError } = await mobileSupabase.auth.signOut();

        if (signOutError) {
          console.warn(
            'Unable to sign out while enforcing re-auth preference.',
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
      const [{ data }, initialUrl] = await Promise.all([
        mobileSupabase.auth.getSession(),
        Linking.getInitialURL(),
      ]);

      if (mounted) {
        setSession(data.session ?? null);
      }

      if (initialUrl) {
        await handleRecoveryLink(initialUrl);
      }

      await enforceReauthIfNeeded();

      if (mounted) {
        setInitializing(false);
      }
    };

    void bootstrap();

    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleRecoveryLink(url);
    });

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState === 'active') {
          void enforceReauthIfNeeded();
        }
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
      <View className={`flex-1 ${nw.screenBg}`}>
        <StatusBar style={statusBarStyle} />
        <SafeAreaView
          className={`flex-1 items-center justify-center ${nw.screenBg}`}
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className={`flex-1 ${nw.screenBg}`}>
      <StatusBar style={statusBarStyle} />
      <NavigationContainer theme={navigationTheme}>
        {showAuthStack ? (
          authStack
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
              name="Settings"
              component={SettingsScreen}
              options={{ title: 'Settings' }}
            />
          </MainStack.Navigator>
        )}
      </NavigationContainer>
    </View>
  );
}

export default App;
