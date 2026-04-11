import React from 'react';
import { render } from '@testing-library/react';
import Page from '../src/app/(public)/page';

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: () => ({ session: null, loading: false }),
}));

describe('Page', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Page />);
    expect(baseElement).toBeTruthy();
  });
});
