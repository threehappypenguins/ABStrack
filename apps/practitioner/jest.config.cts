const nextJest = require('next/jest.js');

const createJestConfig = nextJest({
  dir: './',
});

const config = {
  displayName: '@abstrack/practitioner',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/practitioner',
  testEnvironment: 'jsdom',
  /** Match `next.config.js` webpack alias; chart UI hooks import `react-native`. */
  moduleNameMapper: {
    '^react-native$': 'react-native-web',
    '^@abstrack/ui/insights-web$':
      '<rootDir>/specs/test-support/mock-insights-web.tsx',
    // Next/SWC may resolve the workspace package to `dist` before Jest applies the subpath mapper.
    '.*/packages/ui/dist/insights-web(\\.js)?$':
      '<rootDir>/specs/test-support/mock-insights-web.tsx',
  },
};

module.exports = createJestConfig(config);
