import NetInfo from '@react-native-community/netinfo';

/**
 * One-shot NetInfo read for imperative paths (AppState, data loaders) outside React hooks.
 *
 * @returns `true` / `false` when NetInfo reports `isConnected`, or `null` when unknown / fetch failed.
 */
export async function fetchMobileDeviceIsConnected(): Promise<boolean | null> {
  try {
    const state = await NetInfo.fetch();
    if (typeof state.isConnected === 'boolean') {
      return state.isConnected;
    }
    return null;
  } catch {
    return null;
  }
}
