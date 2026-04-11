module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      /**
       * `jsxImportSource: "nativewind"` is required for NativeWind v4 + Expo so JSX uses NativeWind’s
       * runtime (see https://www.nativewind.dev/docs/getting-started/installation).
       */
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      /**
       * `nativewind/babel` → `react-native-css-interop/babel` (preset object). Must stay in `presets`.
       */
      'nativewind/babel',
    ],
    /** Reanimated’s plugin must be listed last. */
    plugins: ['react-native-reanimated/plugin'],
  };
};
