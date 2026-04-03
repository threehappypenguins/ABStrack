/**
 * Universal entry: types, env, React Native client, auth, and queries.
 * Does **not** import `@supabase/ssr` — safe for Metro without pulling Next SSR code.
 *
 * Next.js: import browser/server factories from `@abstrack/supabase/browser` and
 * `@abstrack/supabase/server`.
 */
export type { Database, Json } from './lib/database.types.js';
export type { Session } from '@supabase/supabase-js';
export { getSupabasePublishableKey, getSupabaseUrl } from './lib/env-public.js';
export type { AbstrackSupabaseClient } from './lib/supabase-client-type.js';
export {
  createSupabaseNativeClient,
  type NativeAuthStorage,
  type NativeClientOptions,
} from './lib/native-client.js';
export {
  getAuthUser,
  getSession,
  signInWithEmailPassword,
  signOut,
  signUpWithEmailPassword,
} from './lib/auth.js';
export {
  fetchProfileByUserId,
  healthCheckProfilesLimit1,
} from './lib/queries.js';
