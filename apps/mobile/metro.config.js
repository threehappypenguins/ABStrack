const path = require('path');

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
    /**
     * `@noble/hashes` exports `./crypto` but Metro sometimes resolves the physical `crypto.js` path,
     * which is not listed under `package.json#exports` and triggers resolution warnings / failures.
     */
    resolveRequest: (context, moduleName, platform) => {
      const nm =
        typeof moduleName === 'string' ? moduleName.replace(/\\/g, '/') : '';
      const isNobleHashesCryptoJs =
        nm === '@noble/hashes/crypto.js' ||
        nm.includes('@noble/hashes/crypto.js') ||
        nm.endsWith('/@noble/hashes/crypto.js') ||
        (typeof moduleName === 'string' &&
          moduleName.includes(
            `${path.sep}@noble${path.sep}hashes${path.sep}crypto.js`,
          ));

      if (isNobleHashesCryptoJs) {
        return {
          type: 'sourceFile',
          filePath: require.resolve('@noble/hashes/crypto'),
        };
      }

      const isPowerSyncPackageJson =
        typeof moduleName === 'string' &&
        moduleName.includes('@powersync') &&
        moduleName.includes('common') &&
        moduleName.endsWith('package.json');

      if (isPowerSyncPackageJson) {
        const commonEntry = require.resolve('@powersync/common');
        return {
          type: 'sourceFile',
          filePath: path.join(path.dirname(commonEntry), '..', 'package.json'),
        };
      }

      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

const mergedConfig = mergeConfig(defaultConfig, customConfig);

module.exports = withNativeWind(mergedConfig, {
  input: './global.css',
  disableTypeScriptGeneration: true,
});
