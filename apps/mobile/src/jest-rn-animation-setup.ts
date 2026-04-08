/**
 * Mocks for `react-native-reanimated` and `react-native-worklets` so Jest does not load native
 * code paths when Babel applies NativeWind (`react-native-css-interop`) and Reanimated plugins.
 * `setUpTests()` enables Reanimated’s Jest matchers and timer helpers.
 *
 * Loaded from `setupFilesAfterEnv` before `test-setup.ts`.
 */

jest.mock('react-native-worklets', () =>
  require('react-native-worklets/lib/module/mock'),
);

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

require('react-native-reanimated').setUpTests();
