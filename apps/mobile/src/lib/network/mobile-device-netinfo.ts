import type { NetInfoState } from '@react-native-community/netinfo';
import NetInfo from '@react-native-community/netinfo';

/**
 * Maps a NetInfo snapshot to whether this app should treat the device as having **usable internet**
 * for auth refresh, Supabase calls, and offline UX (not only a radio association).
 *
 * `isConnected === true` with **`isInternetReachable === false`** (e.g. Wi‑Fi without a route, captive
 * portal) is treated as **offline** (`false`). When `isConnected` is true but **`isInternetReachable`
 * is still `null`** (NetInfo has not finished the reachability probe), returns **`null`**: callers
 * that gate **server** work (e.g. `signOut()` vs `signOut({ scope: 'local' })`) must not treat that
 * as online — startup often reports `isConnected: true` while reachability is unresolved.
 *
 * @param state - Result of {@link NetInfo.fetch} or a listener callback.
 * @returns `true` / `false` when enough is known; `null` when `isConnected` is unknown, or when
 * connected to a transport but internet reachability is not yet known (`isInternetReachable == null`).
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
  if (state.isInternetReachable === true) {
    return true;
  }
  return null;
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
