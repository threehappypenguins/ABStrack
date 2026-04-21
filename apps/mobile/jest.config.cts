/// <reference types="jest" />
/// <reference types="node" />

// Before any transformed expo-modules-core file is evaluated (babel may read env at transform time).
process.env.EXPO_OS = process.env.EXPO_OS ?? 'ios';

const jestExpo = require('jest-expo/jest-preset');

module.exports = {
  ...jestExpo,
  displayName: '@abstrack/mobile',
  setupFiles: [
    '<rootDir>/src/jest-expo-os-setup.js',
    ...(jestExpo.setupFiles ?? []),
  ],
  moduleFileExtensions: ['ts', 'js', 'html', 'tsx', 'jsx'],
  setupFilesAfterEnv: [
    '<rootDir>/src/jest-rn-animation-setup.ts',
    '<rootDir>/src/test-setup.ts',
  ],
  moduleNameMapper: {
    '\\.svg$': '@nx/expo/plugins/jest/svg-mock',
    '\\.css$': '<rootDir>/jest.css-mock.js',
  },
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        configFile: __dirname + '/.babelrc.js',
        // Required for babel-preset-expo (e.g. EXPO_OS) — matches jest-expo/jest-preset.
        caller: { name: 'metro', bundler: 'metro', platform: 'ios' },
      },
    ],
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp|ttf|otf|m4v|mov|mp4|mpeg|mpg|webm|aac|aiff|caf|m4a|mp3|wav|html|pdf|obj)$':
      require.resolve('jest-expo/src/preset/assetFileTransformer.js'),
  },
  coverageDirectory: '../../coverage/apps/mobile',
};
