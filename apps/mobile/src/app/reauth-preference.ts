import * as SecureStore from 'expo-secure-store';

const REQUIRE_REAUTH_KEY = 'abstrack.require_reauth_on_open';

export async function getRequireReauthOnOpenPreference(): Promise<boolean> {
  const storedValue = await SecureStore.getItemAsync(REQUIRE_REAUTH_KEY);
  return storedValue === 'true';
}

export async function setRequireReauthOnOpenPreference(
  enabled: boolean,
): Promise<void> {
  await SecureStore.setItemAsync(
    REQUIRE_REAUTH_KEY,
    enabled ? 'true' : 'false',
  );
}
