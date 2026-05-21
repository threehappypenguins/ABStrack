import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readSidebarOpenCookie,
  writeSidebarOpenCookie,
} from '../lib/sidebar-provider-behavior.js';
import { SidebarProvider, useSidebar } from './sidebar.js';

const useIsMobileMock = vi.hoisted(() => vi.fn(() => false));

vi.mock('../hooks/use-mobile.js', () => ({
  useIsMobile: () => useIsMobileMock(),
}));

const COOKIE = 'abstrack_test_sidebar_provider';

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0`;
}

function OpenStateProbe() {
  const { open } = useSidebar();
  return <div data-testid="sidebar-open">{open ? 'open' : 'closed'}</div>;
}

function MobileOpenProbe() {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <>
      <div data-testid="open-mobile">{openMobile ? 'open' : 'closed'}</div>
      <button type="button" onClick={() => setOpenMobile(true)}>
        Open sheet
      </button>
    </>
  );
}

describe('SidebarProvider cookie persistence', () => {
  afterEach(() => {
    clearCookie(COOKIE);
    useIsMobileMock.mockReturnValue(false);
    vi.unstubAllGlobals();
  });

  it('restores collapsed state from cookie after mount', async () => {
    writeSidebarOpenCookie(COOKIE, false);

    render(
      <SidebarProvider sidebarCookieName={COOKIE} defaultOpen>
        <OpenStateProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-open')).toHaveTextContent('closed');
    });
  });

  it('writes cookie when toggled via keyboard shortcut', async () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Windows',
    });

    render(
      <SidebarProvider sidebarCookieName={COOKIE} defaultOpen>
        <OpenStateProbe />
      </SidebarProvider>,
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'b',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-open')).toHaveTextContent('closed');
      expect(readSidebarOpenCookie(COOKIE)).toBe(false);
    });
  });

  it('does not restore from cookie in controlled mode', async () => {
    writeSidebarOpenCookie(COOKIE, false);
    const onOpenChange = vi.fn();

    render(
      <SidebarProvider
        sidebarCookieName={COOKIE}
        open
        onOpenChange={onOpenChange}
      >
        <OpenStateProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-open')).toHaveTextContent('open');
    });

    expect(readSidebarOpenCookie(COOKIE)).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('SidebarProvider mobile sheet state', () => {
  afterEach(() => {
    useIsMobileMock.mockReturnValue(false);
  });

  it('clears openMobile when the viewport leaves mobile', async () => {
    useIsMobileMock.mockReturnValue(true);

    const { rerender } = render(
      <SidebarProvider>
        <MobileOpenProbe />
      </SidebarProvider>,
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Open sheet' }).click();
    });
    expect(screen.getByTestId('open-mobile')).toHaveTextContent('open');

    useIsMobileMock.mockReturnValue(false);
    rerender(
      <SidebarProvider>
        <MobileOpenProbe />
      </SidebarProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('open-mobile')).toHaveTextContent('closed');
    });
  });
});
