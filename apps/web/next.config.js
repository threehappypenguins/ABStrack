//@ts-check
const path = require('path');
const { composePlugins, withNx } = require('@nx/next');

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
      '@abstrack/ui-web': path.join(
        __dirname,
        '../../packages/ui-web/src/index.ts',
      ),
    };
    return config;
  },
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

module.exports = composePlugins(...plugins)(nextConfig);
