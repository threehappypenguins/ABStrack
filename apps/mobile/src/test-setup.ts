import { configure } from '@testing-library/react-native';

// Async server-mocked flows often finish a tick after `waitFor`/`fireEvent`; React 19 still logs
// this known warning. Suppress only that string so other `console.error` output stays visible.
// Use a spy + restore (not a permanent global override) so tests can assert on `console.error`.
//
// Install per test: `jest.restoreAllMocks()` in a suite clears spies mid-run; a single beforeAll spy
// would stay "dead" until the process ends. Re-apply in beforeEach and restore in afterEach.
const shouldSuppressActWarning = (
  args: Parameters<typeof console.error>,
): boolean => {
  const first = args[0];
  return typeof first === 'string' && first.includes('not wrapped in act');
};

let consoleErrorSpy: jest.SpiedFunction<typeof console.error> | undefined;

beforeEach(() => {
  consoleErrorSpy?.mockRestore();
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

afterEach(() => {
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

jest.mock('expo-file-system', () => ({
  __esModule: true,
  /** Minimal stand-in for Expo SDK 54+ `File` so Jest never touches native file I/O. */
  File: class MockExpoFile {
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new Uint8Array([102, 97, 107, 101]).buffer;
    }
  },
}));

jest.mock('expo-video', () => {
  return {
    VideoView: (props: { accessibilityLabel?: string }) =>
      require('react').createElement(require('react-native').View, {
        accessibilityLabel: props.accessibilityLabel ?? 'Mock video view',
      }),
    useVideoPlayer: jest.fn(() => ({})),
  };
});

configure({ asyncUtilTimeout: 5000 });

jest.mock('@powersync/react', () => {
  const React = require('react');
  return {
    PowerSyncContext: React.createContext(null),
    usePowerSync: () => null,
    useQuery: () => ({
      isLoading: false,
      isFetching: false,
      data: [],
      error: undefined,
    }),
  };
});

jest.mock('./lib/powersync/PowerSyncSessionBridge', () => ({
  PowerSyncSessionBridge: ({ children }: { children: unknown }) => children,
  usePowerSyncBridgeState: () => ({
    powerSyncUrlConfigured: false,
    database: null,
    firstSyncCompleted: false,
    syncConnecting: false,
    syncError: null,
  }),
}));

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
