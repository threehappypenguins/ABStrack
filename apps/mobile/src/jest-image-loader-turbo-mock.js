/**
 * jest-expo’s preset mocks `NativeModules.ImageLoader.getSize` with a legacy
 * `(uri, success)` callback shape. React Native’s `Image.getSize` (promise API)
 * calls `NativeImageLoader*.getSize(uri)`, which expects a Promise of
 * `[width, height]`. Without this patch, `Image.getSize(uri)` throws
 * `TypeError: success is not a function` in Jest.
 *
 * Loaded from `setupFiles` immediately after `jest-expo` preset setup files.
 */
'use strict';

const mockNativeModules =
  require('react-native/Libraries/BatchedBridge/NativeModules').default;

const mockImageLoader = {
  configurable: true,
  enumerable: true,
  get: () => ({
    prefetchImage: jest.fn(),
    getSize: jest.fn((uri) => Promise.resolve([320, 240])),
  }),
};

Object.defineProperty(mockNativeModules, 'ImageLoader', mockImageLoader);
Object.defineProperty(mockNativeModules, 'ImageViewManager', mockImageLoader);
