import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { getMobileSupabaseClient } from '../lib/supabase-wiring';
import { AppProviders } from './components/AppProviders';
import { HomeScreen } from './screens/HomeScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SignupScreen } from './screens/SignupScreen';
import { styles } from './styles';

type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

type MainStackParamList = {
  Home: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

export function App() {
  const mobileSupabase = useMemo(() => getMobileSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [authRoute, setAuthRoute] = useState<'Login' | 'Signup'>('Login');

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const {
        data: { session: initialSession },
      } = await mobileSupabase.auth.getSession();

      if (mounted) {
        setSession(initialSession ?? null);
        setInitializing(false);
      }
    };

    void bootstrap();

    const {
      data: { subscription },
    } = mobileSupabase.auth.onAuthStateChange((event, nextSession) => {
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
    };
  }, [mobileSupabase]);

  const authStack = useMemo(
    () => (
      <AuthStack.Navigator>
        {authRoute === 'Login' ? (
          <AuthStack.Screen name="Login" options={{ title: 'Login' }}>
            {() => <LoginScreen onGoToSignup={() => setAuthRoute('Signup')} />}
          </AuthStack.Screen>
        ) : (
          <AuthStack.Screen name="Signup" options={{ title: 'Sign up' }}>
            {() => <SignupScreen onGoToLogin={() => setAuthRoute('Login')} />}
          </AuthStack.Screen>
        )}
      </AuthStack.Navigator>
    ),
    [authRoute],
  );

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
        {session ? (
          <MainStack.Navigator>
            <MainStack.Screen name="Home" component={HomeScreen} />
          </MainStack.Navigator>
        ) : (
          authStack
        )}
      </NavigationContainer>
    </AppProviders>
  );
}

export default App;
