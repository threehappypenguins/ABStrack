import React from 'react';
import { render } from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import Page from '../src/app/page';
import type { PractitionerSupabaseProfilesRow } from '../src/lib/supabase-wiring';

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: () => ({ session: null, loading: false }),
}));

describe('Page', () => {
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
