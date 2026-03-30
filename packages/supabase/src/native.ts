/**
 * React Native / Expo client factory only (no `@supabase/ssr`).
 * The main `@abstrack/supabase` entry also exports this; use this path when you want an explicit native-only import surface.
 */
export {
  createSupabaseNativeClient,
  type NativeAuthStorage,
  type NativeClientOptions,
} from './lib/native-client.js';
