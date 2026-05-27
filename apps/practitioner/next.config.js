//@ts-check
const path = require('path');
const { composePlugins, withNx } = require('@nx/next');
const {
  buildPractitionerCspDirectives,
  normalizeCspHeaderValue,
} = require('./csp-config.js');

const isDev = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cspEnforce = process.env.PRACTITIONER_CSP_ENFORCE === 'true';

const practitionerCspHeaderValue = normalizeCspHeaderValue(
  buildPractitionerCspDirectives({
    supabaseUrl,
    isDev,
    isProduction,
  }),
);

const practitionerCspHeaders = cspEnforce
  ? [{ key: 'Content-Security-Policy', value: practitionerCspHeaderValue }]
  : [
      {
        key: 'Content-Security-Policy-Report-Only',
        value: practitionerCspHeaderValue,
      },
    ];

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
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
    const uiSrc = path.join(__dirname, '../../packages/ui/src');
    const uiWebSrc = path.join(__dirname, '../../packages/ui-web/src');
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-native$': 'react-native-web',
      '@abstrack/types$': path.join(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
      '@abstrack/supabase$': path.join(supabaseSrc, 'index.ts'),
      '@abstrack/supabase/browser': path.join(supabaseSrc, 'browser.ts'),
      '@abstrack/supabase/server': path.join(supabaseSrc, 'server.ts'),
      '@abstrack/supabase/native': path.join(supabaseSrc, 'native.ts'),
      '@abstrack/supabase/admin': path.join(supabaseSrc, 'admin.ts'),
      '@abstrack/ui$': path.join(uiSrc, 'index.ts'),
      '@abstrack/ui/a11y-web': path.join(uiSrc, 'a11y-web.ts'),
      '@abstrack/ui/insights-web': path.join(uiSrc, 'insights-web.ts'),
      '@abstrack/ui-web$': path.join(uiWebSrc, 'index.ts'),
      '@abstrack/ui-web/sidebar': path.join(uiWebSrc, 'components/sidebar.tsx'),
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: practitionerCspHeaders,
      },
    ];
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
