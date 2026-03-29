import type { EpisodeRow, FoodDiaryEntryRow, ProfileRow } from '@abstrack/types';

/**
 * Compile-only wiring: `@abstrack/types` must resolve when the web app typechecks.
 * Not imported at runtime; kept in the program via tsconfig `include`.
 */
export type WebAppAbstrackTypesWiring = Pick<ProfileRow, 'app_role'> &
  Pick<EpisodeRow, 'episode_type'> &
  Pick<FoodDiaryEntryRow, 'meal_tag'>;
