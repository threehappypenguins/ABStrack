/**
 * Service-role client and secret key — **server-only**. Import `@abstrack/supabase/admin`
 * from Node / Next server segments only; never from client components or mobile UI bundles.
 */
export {
  getSupabaseAdminClient,
  getSupabaseServiceRoleKey,
} from './lib/admin-client.js';
