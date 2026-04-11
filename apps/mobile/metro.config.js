const { getDefaultConfig } = require('@expo/metro-config');
const { mergeConfig } = require('metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Metro for Expo + NativeWind v4.
 *
 * Do **not** wrap with `withNxMetro` from `@nx/expo` here: `pnpm mobile` runs `expo start` with cwd
 * `apps/mobile`, and that wrapper has broken NativeWind’s pipeline in this repo (Metro/config not
 * applying `withNativeWind` correctly). If you need Nx-style `watchFolders` for workspace packages,
 * add explicit `watchFolders` / `resolver.nodeModulesPaths` instead of `withNxMetro`.
 *
 * @type {import('metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

const customConfig = {
  cacheVersion: '@abstrack/mobile-theme-class',
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'cjs', 'mjs', 'svg'],
  },
};

const mergedConfig = mergeConfig(defaultConfig, customConfig);

module.exports = withNativeWind(mergedConfig, {
  input: './global.css',
  disableTypeScriptGeneration: true,
});
