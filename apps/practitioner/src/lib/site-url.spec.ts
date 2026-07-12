import {
  PRODUCTION_PRACTITIONER_WEB_ORIGIN,
  getMetadataBase,
  getSiteUrl,
} from './site-url';

describe('getSiteUrl', () => {
  const prevOrigin = process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (prevOrigin === undefined) {
      delete process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN;
    } else {
      process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN = prevOrigin;
    }
    process.env.NODE_ENV = prevNodeEnv;
  });

  it('uses NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN when set', () => {
    process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN =
      'https://practitioner.example.com/';
    expect(getSiteUrl()).toBe('https://practitioner.example.com');
  });

  it('defaults to production origin in production when env is unset', () => {
    delete process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    expect(getSiteUrl()).toBe(PRODUCTION_PRACTITIONER_WEB_ORIGIN);
  });

  it('defaults to localhost in non-production when env is unset', () => {
    delete process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN;
    process.env.NODE_ENV = 'development';
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });
});

describe('getMetadataBase', () => {
  it('returns a trailing-slash URL', () => {
    process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN =
      'https://practitioner.abstrack.org';
    expect(getMetadataBase().href).toBe('https://practitioner.abstrack.org/');
  });
});
