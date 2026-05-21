import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppNotFoundPanel } from './AppNotFoundPanel.js';

describe('AppNotFoundPanel', () => {
  it('renders themed copy without a recovery link by default', () => {
    render(<AppNotFoundPanel />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses unique heading ids when rendered more than once', () => {
    render(
      <>
        <AppNotFoundPanel />
        <AppNotFoundPanel />
      </>,
    );

    const headings = screen.getAllByRole('heading', { name: 'Page not found' });
    expect(headings).toHaveLength(2);
    expect(headings[0]?.id).toBeTruthy();
    expect(headings[1]?.id).toBeTruthy();
    expect(headings[0]?.id).not.toBe(headings[1]?.id);
  });

  it('renders an optional recovery link when provided', () => {
    render(
      <AppNotFoundPanel homeLink={<a href="/patients">Go to patients</a>} />,
    );

    expect(
      screen.getByRole('link', { name: 'Go to patients' }),
    ).toHaveAttribute('href', '/patients');
  });
});
