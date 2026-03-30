/**
 * Secret-key admin client — **server-only** (bypasses RLS). Import `@abstrack/supabase/admin`
 * from Node / Next server segments only; never from client components or mobile UI bundles.
 */
export {
  getSupabaseAdminClient,
  getSupabaseSecretKey,
} from './lib/admin-client.js';
