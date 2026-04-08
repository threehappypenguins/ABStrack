const { withNxMetro } = require('@nx/expo');
const { getDefaultConfig } = require('@expo/metro-config');
const { mergeConfig } = require('metro-config');
const { withNativeWind } = require('nativewind/metro');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const customConfig = {
  cacheVersion: '@abstrack/mobile',
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'cjs', 'mjs', 'svg'],
  },
};

const mergedConfig = mergeConfig(defaultConfig, customConfig);

const withWind = withNativeWind(mergedConfig, {
  input: './global.css',
  /** Types are checked in via committed `nativewind-env.d.ts`. */
  disableTypeScriptGeneration: true,
});

module.exports = withNxMetro(withWind, {
  debug: false,
  extensions: [],
  watchFolders: [],
});
