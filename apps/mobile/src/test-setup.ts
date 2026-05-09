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

/**
 * In-memory blob store for the `expo-file-system` Jest mock (`File.bytes`, `write`, etc.).
 * Cleared each test so offline-queue / crypto specs do not leak paths across cases.
 *
 * Prefixed `mock` so Jest allows the `jest.mock('expo-file-system')` factory to close over it.
 */
const mockExpoFileSystemByteStore = new Map<string, Uint8Array>();

beforeEach(() => {
  mockExpoFileSystemByteStore.clear();
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

jest.mock('expo-file-system', () => {
  const store = mockExpoFileSystemByteStore;

  function resolvePathRoot(first: unknown): string {
    if (typeof first === 'string') {
      return first;
    }
    if (
      first !== null &&
      typeof first === 'object' &&
      'uri' in first &&
      typeof (first as { uri: unknown }).uri === 'string'
    ) {
      return (first as { uri: string }).uri;
    }
    return String(first);
  }

  class Directory {
    readonly uri: string;

    constructor(baseUri: string, ...segments: string[]) {
      const base = baseUri.replace(/\/+$/, '');
      this.uri = segments.length > 0 ? `${base}/${segments.join('/')}` : base;
    }

    create(_options?: { intermediates?: boolean; overwrite?: boolean }): void {
      /* no-op in Jest — directory hierarchy is not modeled */
    }
  }

  class File {
    private readonly key: string;

    constructor(first: unknown, ...segments: string[]) {
      if (segments.length === 0) {
        this.key = resolvePathRoot(first);
      } else {
        const root = resolvePathRoot(first).replace(/\/+$/, '');
        this.key = `${root}/${segments.join('/')}`;
      }
    }

    create(options?: { intermediates?: boolean; overwrite?: boolean }): void {
      if (options?.overwrite && store.has(this.key)) {
        store.delete(this.key);
      }
      if (!store.has(this.key)) {
        store.set(this.key, new Uint8Array(0));
      }
    }

    write(data: Uint8Array): void {
      store.set(this.key, new Uint8Array(data));
    }

    get exists(): boolean {
      return store.has(this.key);
    }

    get size(): number {
      return store.get(this.key)?.byteLength ?? 0;
    }

    async bytes(): Promise<Uint8Array> {
      const bytes = store.get(this.key);
      if (!bytes) {
        throw new Error(
          `Mock expo-file-system File.bytes: missing "${this.key}"`,
        );
      }
      return new Uint8Array(bytes);
    }

    delete(): void {
      store.delete(this.key);
    }

    /**
     * Used by capture upload flows (`SymptomPromptScreen`) with `new File(localUri)` — when the URI
     * was never written in Jest, fall back to stable fake bytes (legacy mock behavior).
     */
    async arrayBuffer(): Promise<ArrayBuffer> {
      const bytes = store.get(this.key);
      if (!bytes) {
        return new Uint8Array([102, 97, 107, 101]).buffer;
      }
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    }
  }

  const Paths = {
    document: new Directory('file:///jest-mock-expo-fs/Documents'),
  };

  return {
    __esModule: true,
    Directory,
    File,
    Paths,
  };
});

/** `getMobileAuthSessionSafe` falls back to SecureStore when GoTrue rejects; real native calls can hang Jest. */
jest.mock('expo-secure-store', () => {
  /** Stable numeric stand-in for `expo-secure-store` `WHEN_UNLOCKED_THIS_DEVICE_ONLY` in Jest. */
  const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;
  return {
    __esModule: true,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    getItemAsync: jest.fn(async () => null),
    setItemAsync: jest.fn(async () => undefined),
    deleteItemAsync: jest.fn(async () => undefined),
  };
});

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
    firstSyncLandedOnDevice: false,
    firstSyncLandingHydrated: true,
  };
  return {
    PowerSyncSessionBridge: ({ children }: { children: unknown }) => children,
    /** Mirrors production logic; avoid `requireActual` here (pulls native PowerSync into Jest). */
    powerSyncOfflineReplicaReadsEnabled: (bridge: {
      powerSyncUrlConfigured: boolean;
      database: unknown;
      firstSyncCompleted: boolean;
      localSqliteInitialized: boolean;
      firstSyncLandedOnDevice?: boolean;
      firstSyncLandingHydrated?: boolean;
    }) => {
      const mirrorTrusted =
        bridge.firstSyncCompleted ||
        ((bridge.firstSyncLandingHydrated ?? true) &&
          Boolean(bridge.firstSyncLandedOnDevice));
      return Boolean(
        bridge.powerSyncUrlConfigured &&
          bridge.database &&
          bridge.localSqliteInitialized &&
          mirrorTrusted,
      );
    },
    powerSyncReplicaSqliteReady: (bridge: {
      database: unknown;
      localSqliteInitialized: boolean;
    }) => Boolean(bridge.database && bridge.localSqliteInitialized),
    usePowerSyncBridgeState: () => mockBridgeState,
    usePowerSyncManualResync: () => ({
      requestManualResync: jest.fn().mockResolvedValue(true),
      manualResyncBusy: false,
    }),
  };
});

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
