import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppNotFoundPage } from './AppNotFoundPage.js';

describe('AppNotFoundPage', () => {
  it('renders the panel inside main by default', () => {
    render(<AppNotFoundPage />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Page not found' }),
    );
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });

  it('renders the panel alone when wrapInMain is false', () => {
    render(<AppNotFoundPage wrapInMain={false} />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('renders top nav and main when topNav is provided', () => {
    render(<AppNotFoundPage topNav={<header role="banner">Top nav</header>} />);

    expect(screen.getByRole('banner')).toHaveTextContent('Top nav');
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Page not found' }),
    );
  });
});
