import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppNotFoundPage } from './AppNotFoundPage.js';

describe('AppNotFoundPage', () => {
  it('renders the panel alone when topNav is omitted', () => {
    render(<AppNotFoundPage />);

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('renders top nav and a main landmark when topNav is provided', () => {
    render(<AppNotFoundPage topNav={<header role="banner">Top nav</header>} />);

    expect(screen.getByRole('banner')).toHaveTextContent('Top nav');
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Page not found' }),
    );
  });
});
