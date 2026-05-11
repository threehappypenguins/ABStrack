import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Hostname from `EXPO_PUBLIC_USER_WEB_ORIGIN` for iOS Universal Links + Android App Links
 * (`applinks:` / `autoVerify` intent filters on **`/auth/callback` only** — not `/caretaker/join`,
 * because the web callback exchanges `code` then redirects to `/caretaker/join` without `code`).
 */
function userWebHostAndSchemeFromEnv(): {
  host: string;
  schemes: readonly ('http' | 'https')[];
} | null {
  const raw = process.env.EXPO_PUBLIC_USER_WEB_ORIGIN?.trim() ?? '';
  if (raw === '') {
    return null;
  }
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    const scheme = u.protocol === 'http:' ? 'http' : 'https';
    return {
      host: u.hostname,
      schemes:
        scheme === 'http' ? (['http', 'https'] as const) : (['https'] as const),
    };
  } catch {
    return null;
  }
}

/**
 * @see https://docs.expo.dev/linking/ios-universal-links/
 * @see https://docs.expo.dev/linking/android-app-links/
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const parsed = userWebHostAndSchemeFromEnv();
  if (!parsed) {
    return config;
  }
  const { host, schemes } = parsed;

  const applink = `applinks:${host}`;
  const existingDomains = config.ios?.associatedDomains ?? [];
  const associatedDomains = existingDomains.includes(applink)
    ? existingDomains
    : [...existingDomains, applink];

  const existingFilters = config.android?.intentFilters ?? [];
  const caretakerInviteFilters = schemes.map((scheme) => ({
    action: 'VIEW' as const,
    autoVerify: scheme === 'https',
    data: [{ scheme, host, pathPrefix: '/auth/callback' }],
    category: ['BROWSABLE' as const, 'DEFAULT' as const],
  }));

  return {
    ...config,
    ios: {
      ...config.ios,
      associatedDomains,
    },
    android: {
      ...config.android,
      intentFilters: [...existingFilters, ...caretakerInviteFilters],
    },
  };
};
