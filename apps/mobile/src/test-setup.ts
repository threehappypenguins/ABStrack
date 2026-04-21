import { configure } from '@testing-library/react-native';

// Async server-mocked flows often finish a tick after `waitFor`/`fireEvent`; React 19 still logs
// this known warning. Suppress only that string so other `console.error` output stays visible.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string' && first.includes('not wrapped in act')) {
    return;
  }
  originalConsoleError.apply(console, args as Parameters<typeof console.error>);
};

jest.mock('expo/src/winter/ImportMetaRegistry', () => ({
  ImportMetaRegistry: {
    get url() {
      return null;
    },
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock').default;
  return {
    __esModule: true,
    ...mock,
    default: mock,
  };
});

configure({ asyncUtilTimeout: 5000 });

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
