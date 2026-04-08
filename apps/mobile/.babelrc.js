module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
      /**
       * `nativewind/babel` → `react-native-css-interop/babel`, which returns a **preset**
       * object `{ plugins: [...] }`, not a single plugin. It belongs in `presets` so Babel merges
       * those plugins; listing it under `plugins` fails validation (`.plugins is not a valid Plugin property`).
       */
      'nativewind/babel',
    ],
    /** Reanimated’s plugin must be listed last. */
    plugins: ['react-native-reanimated/plugin'],
  };
};
