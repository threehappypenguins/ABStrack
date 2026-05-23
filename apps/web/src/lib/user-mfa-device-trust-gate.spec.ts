const prevTrustEnv = process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'];
const prevCspEnv = process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
const prevNodeEnv = process.env['NODE_ENV'];

afterEach(() => {
  if (prevTrustEnv === undefined) {
    delete process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'];
  } else {
    process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'] = prevTrustEnv;
  }
  if (prevCspEnv === undefined) {
    delete process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
  } else {
    process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'] = prevCspEnv;
  }
  if (prevNodeEnv === undefined) {
    delete process.env['NODE_ENV'];
  } else {
    process.env['NODE_ENV'] = prevNodeEnv;
  }
});

describe('isUserMfaDeviceTrustEnabled', () => {
  it('is disabled when the trust env var is unset', async () => {
    delete process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'];
    delete process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
    const { isUserMfaDeviceTrustEnabled } = await import(
      './user-mfa-device-trust'
    );
    expect(isUserMfaDeviceTrustEnabled()).toBe(false);
  });

  it('is disabled when trust is explicitly false', async () => {
    process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'] = 'false';
    const { isUserMfaDeviceTrustEnabled } = await import(
      './user-mfa-device-trust'
    );
    expect(isUserMfaDeviceTrustEnabled()).toBe(false);
  });

  it('is enabled in development when trust is explicitly true', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'] = 'true';
    delete process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
    const { isUserMfaDeviceTrustEnabled } = await import(
      './user-mfa-device-trust'
    );
    expect(isUserMfaDeviceTrustEnabled()).toBe(true);
  });

  it('requires enforced CSP in production builds', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'] = 'true';
    delete process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
    jest.resetModules();
    const { isUserMfaDeviceTrustEnabled } = await import(
      './user-mfa-device-trust'
    );
    expect(isUserMfaDeviceTrustEnabled()).toBe(false);

    process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'] = 'true';
    jest.resetModules();
    const { isUserMfaDeviceTrustEnabled: enabledWithCsp } = await import(
      './user-mfa-device-trust'
    );
    expect(enabledWithCsp()).toBe(true);
  });
});
