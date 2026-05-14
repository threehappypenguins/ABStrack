import React from 'react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import { render } from '@testing-library/react';
import Page from '../src/app/(public)/page';
import { ThemeProvider } from '../src/components/theme/ThemeProvider';

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: () => ({ session: null, loading: false }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
    prefetch: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));

jest.mock('../src/app/(public)/components/LandingDashboardCharts', () => ({
  LandingDashboardCharts: () => (
    <div data-testid="landing-dashboard-charts-stub" aria-hidden />
  ),
}));

describe('Page', () => {
  it('should render successfully', () => {
    const { baseElement } = render(
      <ThemeProvider>
        <LiveAnnouncerProvider>
          <Page />
        </LiveAnnouncerProvider>
      </ThemeProvider>,
    );
    expect(baseElement).toBeTruthy();
  });
});
