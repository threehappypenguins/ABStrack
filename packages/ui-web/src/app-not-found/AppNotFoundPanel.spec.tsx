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

  it('uses distinct heading ids when callers pass them explicitly', () => {
    render(
      <>
        <AppNotFoundPanel headingId="not-found-a" />
        <AppNotFoundPanel headingId="not-found-b" />
      </>,
    );

    const headings = screen.getAllByRole('heading', { name: 'Page not found' });
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveAttribute('id', 'not-found-a');
    expect(headings[1]).toHaveAttribute('id', 'not-found-b');
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
