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
    '@abstrack/types',
    '@abstrack/supabase',
    'react-native',
    'react-native-web',
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-native$': 'react-native-web',
      // Resolve to source: package `exports` default points at `dist/`, which is easy to forget to
      // rebuild and causes runtime undefined exports (e.g. new helpers not in dist yet).
      '@abstrack/types': path.join(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
      '@abstrack/supabase': path.join(
        __dirname,
        '../../packages/supabase/src/index.ts',
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
