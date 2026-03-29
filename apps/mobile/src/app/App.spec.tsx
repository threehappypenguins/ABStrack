import * as React from 'react';
import { render } from '@testing-library/react-native';

import App from './App';
import { createMobileSupabaseClient } from '../lib/supabase-wiring';

test('renders correctly', () => {
  const { getByTestId } = render(<App />);
  expect(getByTestId('heading')).toHaveTextContent(/Welcome/);
});

test('@abstrack/supabase native factory wires with env', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  expect(createMobileSupabaseClient()).toBeTruthy();
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
});
