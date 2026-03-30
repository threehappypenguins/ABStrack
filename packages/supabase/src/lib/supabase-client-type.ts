import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

/**
 * Canonical app client type from `@supabase/supabase-js`.
 *
 * `@supabase/ssr` factories are still typed with an older `SupabaseClient<Database, SchemaName, Schema>`
 * triple that no longer matches v2.100’s class generics, which makes their return values not assignable
 * to `createClient`’s `SupabaseClient` (protected `supabaseUrl` / nominal class rules). Our SSR helpers
 * therefore assert to this alias at the boundary.
 */
export type AbstrackSupabaseClient = SupabaseClient<Database>;
