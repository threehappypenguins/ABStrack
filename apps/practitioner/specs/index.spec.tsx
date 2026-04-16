import React from 'react';
import { render } from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import Page from '../src/app/page';
import type { PractitionerSupabaseProfilesRow } from '../src/lib/supabase-wiring';

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: () => ({ session: null, loading: false }),
}));

/** Home page calls `getSupabaseBrowserClient()` on mount; env-public throws without URL + key. */
const JEST_SUPABASE_URL = 'https://test.supabase.co';
const JEST_SUPABASE_KEY = 'sb_publishable_test_jest_placeholder';

describe('Page', () => {
  let prevUrl: string | undefined;
  let prevKey: string | undefined;

  beforeAll(() => {
    prevUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    prevKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = prevUrl ?? JEST_SUPABASE_URL;
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] =
      prevKey ?? JEST_SUPABASE_KEY;
  });

  afterAll(() => {
    if (prevUrl === undefined) {
      delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
    } else {
      process.env['NEXT_PUBLIC_SUPABASE_URL'] = prevUrl;
    }
    if (prevKey === undefined) {
      delete process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
    } else {
      process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = prevKey;
    }
  });

  it('should render successfully', () => {
    const { baseElement } = render(
      <LiveAnnouncerProvider>
        <Page />
      </LiveAnnouncerProvider>,
    );
    expect(baseElement).toBeTruthy();
  });

  it('resolves @abstrack/supabase types', () => {
    const row: PractitionerSupabaseProfilesRow | null = null;
    expect(row).toBeNull();
  });
});
