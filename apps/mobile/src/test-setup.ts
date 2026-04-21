import { configure } from '@testing-library/react-native';

// Async server-mocked flows often finish a tick after `waitFor`/`fireEvent`; React 19 still logs
// this known warning. Suppress only that string so other `console.error` output stays visible.
// Use a spy + restore (not a permanent global override) so tests can assert on `console.error`.
const shouldSuppressActWarning = (
  args: Parameters<typeof console.error>,
): boolean => {
  const first = args[0];
  return typeof first === 'string' && first.includes('not wrapped in act');
};

let consoleErrorSpy: jest.SpiedFunction<typeof console.error> | undefined;

beforeAll(() => {
  const original = console.error.bind(console);
  consoleErrorSpy = jest
    .spyOn(console, 'error')
    .mockImplementation((...args: Parameters<typeof console.error>) => {
      if (shouldSuppressActWarning(args)) {
        return;
      }
      original(...args);
    });
});

afterAll(() => {
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = undefined;
});

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
