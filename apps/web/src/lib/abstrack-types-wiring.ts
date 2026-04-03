import type {
  EpisodeRow,
  FoodDiaryEntryRow,
  ProfileRow,
} from '@abstrack/types';
import type { Database } from '@abstrack/supabase';

/**
 * Compile-only wiring: `@abstrack/types` and `@abstrack/supabase` must resolve when the web app typechecks.
 * Not imported at runtime; kept in the program via tsconfig `include`.
 */
export type WebAppAbstrackTypesWiring = Pick<ProfileRow, 'app_role'> &
  Pick<EpisodeRow, 'episode_type'> &
  Pick<FoodDiaryEntryRow, 'meal_tag'>;

/** `Database` table row for `profiles` (Week 2 schema). */
export type WebSupabaseProfilesRow =
  Database['public']['Tables']['profiles']['Row'];
