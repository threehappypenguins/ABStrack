import { getPublicErrorBoundaryMessage } from './public-error-message';

describe('getPublicErrorBoundaryMessage', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns error.message in development', () => {
    process.env.NODE_ENV = 'development';
    expect(getPublicErrorBoundaryMessage(new Error('Debug detail'))).toBe(
      'Debug detail',
    );
  });

  it('returns generic copy in production', () => {
    process.env.NODE_ENV = 'production';
    expect(
      getPublicErrorBoundaryMessage(new Error('Internal stack trace')),
    ).toBe('Please try again.');
  });

  it('includes digest in production when set', () => {
    process.env.NODE_ENV = 'production';
    const err = Object.assign(new Error('x'), { digest: 'abc123' });
    expect(getPublicErrorBoundaryMessage(err)).toContain('abc123');
  });
});
