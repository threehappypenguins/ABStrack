import type { NetInfoState } from '@react-native-community/netinfo';
import NetInfo from '@react-native-community/netinfo';

/**
 * Maps a NetInfo snapshot to whether this app should treat the device as having **usable internet**
 * for auth refresh, Supabase calls, and offline UX (not only a radio association).
 *
 * `isConnected === true` with **`isInternetReachable === false`** (e.g. Wi‑Fi without a route, captive
 * portal) is treated as **offline** (`false`). When `isInternetReachable` is **`null`** (unknown),
 * we still return **`true`** if `isConnected` is true so platforms that omit reachability are not
 * stuck in offline mode.
 *
 * @param state - Result of {@link NetInfo.fetch} or a listener callback.
 * @returns `true` / `false` when enough is known, or `null` when `isConnected` is unknown.
 */
export function mapNetInfoStateToAppOnline(
  state: NetInfoState,
): boolean | null {
  if (typeof state.isConnected !== 'boolean') {
    return null;
  }
  if (!state.isConnected) {
    return false;
  }
  if (state.isInternetReachable === false) {
    return false;
  }
  return true;
}

/**
 * One-shot NetInfo read for imperative paths (AppState, data loaders) outside React hooks.
 *
 * @returns Same semantics as {@link mapNetInfoStateToAppOnline}, or `null` when fetch fails.
 */
export async function fetchMobileDeviceIsConnected(): Promise<boolean | null> {
  try {
    const state = await NetInfo.fetch();
    return mapNetInfoStateToAppOnline(state);
  } catch {
    return null;
  }
}
