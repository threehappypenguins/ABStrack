//@ts-check
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
