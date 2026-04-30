/**
 * jest-expo’s preset mocks `NativeModules.ImageLoader.getSize` with a legacy
 * `(uri, success)` callback shape. React Native’s `Image.getSize` (promise API)
 * calls `NativeImageLoader*.getSize(uri)`, which expects a Promise of
 * `[width, height]`. Without this patch, `Image.getSize(uri)` throws
 * `TypeError: success is not a function` in Jest.
 *
 * TurboModule wiring in tests can also surface a **raw `[w, h]` array** from
 * `await Image.getSize(uri)` (skipping RN’s usual tuple→`{ width, height }`
 * mapping). {@link SymptomPromptScreen} destructures an object; we normalize
 * the promise result so tests exercise the same shape as on-device code.
 *
 * Loaded from `setupFiles` immediately after `jest-expo` preset setup files.
 */
const mockNativeModules =
  require('react-native/Libraries/BatchedBridge/NativeModules').default;

const mockImageLoader = {
  configurable: true,
  enumerable: true,
  get: () => ({
    prefetchImage: jest.fn(),
    /** Native contract: tuple — RN `Image.getSize` maps this to `{ width, height }`. */
    getSize: jest.fn((uri) => Promise.resolve([320, 240])),
  }),
};

Object.defineProperty(mockNativeModules, 'ImageLoader', mockImageLoader);
Object.defineProperty(mockNativeModules, 'ImageViewManager', mockImageLoader);

const ReactNative = require('react-native');

const originalGetSize = ReactNative.Image.getSize.bind(ReactNative.Image);

ReactNative.Image.getSize = function imageGetSizeNormalized(
  uri,
  success,
  failure,
) {
  if (typeof success === 'function') {
    return originalGetSize(uri, success, failure);
  }
  return Promise.resolve(originalGetSize(uri)).then((result) => {
    if (Array.isArray(result) && result.length >= 2) {
      return { width: result[0], height: result[1] };
    }
    return result;
  });
};
