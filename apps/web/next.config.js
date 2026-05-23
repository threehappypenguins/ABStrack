//@ts-check
const path = require('path');
const { composePlugins, withNx } = require('@nx/next');
const {
  buildUserWebCspDirectives,
  normalizeCspHeaderValue,
} = require('./csp-config.js');

const isDev = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cspEnforce = process.env.USER_WEB_CSP_ENFORCE === 'true';

const userWebCspHeaderValue = normalizeCspHeaderValue(
  buildUserWebCspDirectives({
    supabaseUrl,
    isDev,
    isProduction,
  }),
);

const userWebCspHeaders = cspEnforce
  ? [{ key: 'Content-Security-Policy', value: userWebCspHeaderValue }]
  : [
      {
        key: 'Content-Security-Policy-Report-Only',
        value: userWebCspHeaderValue,
      },
    ];

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
  // Transpile workspace packages. `@abstrack/types` must match TS `customConditions: @abstrack/source`
  // so the dev server does not bundle a stale `packages/types/dist` (see webpack alias below).
  transpilePackages: [
    '@abstrack/ui',
    '@abstrack/ui-web',
    '@abstrack/types',
    '@abstrack/supabase',
    'react-native',
    'react-native-web',
  ],
  webpack: (config) => {
    const supabaseSrc = path.join(__dirname, '../../packages/supabase/src');
    const uiWebSrc = path.join(__dirname, '../../packages/ui-web/src');
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-native$': 'react-native-web',
      // Resolve to source: package `exports` default points at `dist/`, which is easy to forget to
      // rebuild and causes runtime undefined exports (e.g. new helpers not in dist yet).
      // Use exact `$` on the root entry so subpath imports (`/browser`, `/server`, …) are not
      // rewritten to `index.ts/<subpath>`; map subpaths explicitly to match package.json exports.
      '@abstrack/types$': path.join(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
      '@abstrack/supabase$': path.join(supabaseSrc, 'index.ts'),
      '@abstrack/supabase/browser': path.join(supabaseSrc, 'browser.ts'),
      '@abstrack/supabase/server': path.join(supabaseSrc, 'server.ts'),
      '@abstrack/supabase/native': path.join(supabaseSrc, 'native.ts'),
      '@abstrack/supabase/admin': path.join(supabaseSrc, 'admin.ts'),
      '@abstrack/ui-web$': path.join(uiWebSrc, 'index.ts'),
      '@abstrack/ui-web/sidebar': path.join(uiWebSrc, 'components/sidebar.tsx'),
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: userWebCspHeaders,
      },
    ];
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
