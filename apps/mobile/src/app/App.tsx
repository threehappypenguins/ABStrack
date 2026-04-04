import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../lib/supabase-wiring';
import { AppProviders } from './components/AppProviders';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SignupScreen } from './screens/SignupScreen';
import { UpdatePasswordScreen } from './screens/UpdatePasswordScreen';
import { styles } from './styles';

type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  UpdatePassword: undefined;
};

type MainStackParamList = {
  Home: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

type AuthRoute = keyof AuthStackParamList;

function parseDeepLinkParams(url: string): URLSearchParams {
  try {
    const parsedUrl = new URL(url);
    const params = new URLSearchParams(parsedUrl.search);
    const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));

    hashParams.forEach((value, key) => {
      params.set(key, value);
    });

    return params;
  } catch {
    return new URLSearchParams();
  }
}

function getRecoveryErrorMessage(params: URLSearchParams): string | null {
  const providerError = params.get('error_description') ?? params.get('error');
  if (providerError) {
    return 'This reset link is invalid or expired. Request a new one.';
  }

  return null;
}

export function App() {
  const mobileSupabase = useMemo(() => getMobileSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authRoute, setAuthRoute] = useState<AuthRoute>('Login');
  const [recoveryFlowActive, setRecoveryFlowActive] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const handleRecoveryLink = async (url: string) => {
      const params = parseDeepLinkParams(url);
      const code = params.get('code');
      const type = params.get('type');
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const hasRecoveryPayload =
        type === 'recovery' ||
        Boolean(code) ||
        (Boolean(accessToken) && Boolean(refreshToken));

      if (!hasRecoveryPayload || !mounted) {
        return;
      }

      setRecoveryFlowActive(true);
      setAuthRoute('UpdatePassword');

      const providerError = getRecoveryErrorMessage(params);
      if (providerError) {
        setRecoveryError(providerError);
        return;
      }

      if (code) {
        const { error } = await mobileSupabase.auth.exchangeCodeForSession(code);
        if (error) {
          setRecoveryError('This reset link is invalid or expired. Request a new one.');
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
          setRecoveryError('This reset link is invalid or expired. Request a new one.');
        } else {
          setRecoveryError(null);
        }
        return;
      }

      setRecoveryError('This reset link is invalid or expired. Request a new one.');
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

      if (mounted) {
        setInitializing(false);
      }
    };

    void bootstrap();

    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleRecoveryLink(url);
    });

    const {
      data: { subscription },
    } = mobileSupabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
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
      urlSubscription.remove();
    };
  }, [mobileSupabase]);

  const authStack = useMemo(
    () => (
      <AuthStack.Navigator>
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
                  setRecoveryFlowActive(false);
                  setRecoveryError(null);
                  setAuthRoute('Login');
                }}
                onPasswordUpdated={() => {
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
    [authRoute, recoveryError],
  );

  const showAuthStack = !session || recoveryFlowActive;

  if (initializing) {
    return (
      <AppProviders>
        <SafeAreaView style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
        </SafeAreaView>
      </AppProviders>
    );
  }

  return (
    <AppProviders>
      <NavigationContainer>
        {showAuthStack ? (
          authStack
        ) : (
          <MainStack.Navigator>
            <MainStack.Screen name="Home" component={HomeScreen} />
          </MainStack.Navigator>
        )}
      </NavigationContainer>
    </AppProviders>
  );
}

export default App;
