import type { Database } from '@abstrack/supabase';

/** Compile-time check that the practitioner app resolves `@abstrack/supabase`. */
export type PractitionerSupabaseProfilesRow =
  Database['public']['Tables']['profiles']['Row'];
