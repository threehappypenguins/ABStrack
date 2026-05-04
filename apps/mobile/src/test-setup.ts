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

/** `getMobileAuthSessionSafe` falls back to SecureStore when GoTrue rejects; real native calls can hang Jest. */
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
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

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() =>
      Promise.resolve({
        isConnected: true,
        isInternetReachable: true,
      }),
    ),
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

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

jest.mock('./lib/powersync/PowerSyncSessionBridge', () => {
  /** Stable reference so screen hooks that depend on `[psBridge]` do not thrash `useFocusEffect`. */
  const mockBridgeState = {
    syncChromeEnabled: false,
    powerSyncUrlConfigured: false,
    database: null,
    firstSyncCompleted: false,
    localSqliteInitialized: false,
    syncConnecting: false,
    syncError: null,
  };
  return {
    PowerSyncSessionBridge: ({ children }: { children: unknown }) => children,
    /** Mirrors production logic; avoid `requireActual` here (pulls native PowerSync into Jest). */
    powerSyncOfflineReplicaReadsEnabled: (bridge: {
      powerSyncUrlConfigured: boolean;
      database: unknown;
      firstSyncCompleted: boolean;
      localSqliteInitialized: boolean;
    }) =>
      Boolean(
        bridge.powerSyncUrlConfigured &&
          bridge.database &&
          (bridge.firstSyncCompleted || bridge.localSqliteInitialized),
      ),
    powerSyncReplicaSqliteReady: (bridge: {
      database: unknown;
      localSqliteInitialized: boolean;
    }) => Boolean(bridge.database && bridge.localSqliteInitialized),
    usePowerSyncBridgeState: () => mockBridgeState,
    usePowerSyncManualResync: () => ({
      requestManualResync: jest.fn().mockResolvedValue(undefined),
      manualResyncBusy: false,
    }),
  };
});

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
