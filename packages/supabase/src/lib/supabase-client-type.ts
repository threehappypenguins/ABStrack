import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

/**
 * Any Supabase client for this schema (browser, Next server, or React Native).
 * Defined with `@supabase/supabase-js` only so auth/query helpers do not import `@supabase/ssr`.
 */
export type AbstrackSupabaseClient = SupabaseClient<Database>;
