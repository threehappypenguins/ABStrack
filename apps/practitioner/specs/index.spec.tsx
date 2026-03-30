import React from 'react';
import { render } from '@testing-library/react';
import Page from '../src/app/page';
import type { PractitionerSupabaseProfilesRow } from '../src/lib/supabase-wiring';

describe('Page', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Page />);
    expect(baseElement).toBeTruthy();
  });

  it('resolves @abstrack/supabase types', () => {
    const row: PractitionerSupabaseProfilesRow | null = null;
    expect(row).toBeNull();
  });
});
