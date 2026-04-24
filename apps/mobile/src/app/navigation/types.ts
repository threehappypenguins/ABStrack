/**
 * Param lists for authenticated mobile navigation (tabs + stack overlays).
 */

import type { NavigatorScreenParams } from '@react-navigation/native';

/** Stack inside the Symptom presets tab: list, create, edit. */
export type SymptomPresetsStackParamList = {
  SymptomPresetList: undefined;
  SymptomPresetCreate: undefined;
  SymptomPresetEdit: { presetId: string };
};

/** Stack inside the Health marker presets tab: list, create, edit. */
export type HealthMarkerPresetsStackParamList = {
  HealthMarkerPresetList: undefined;
  HealthMarkerPresetCreate: undefined;
  HealthMarkerPresetEdit: { presetId: string };
};

/** Stack inside the Episode templates tab: list, create, edit. */
export type EpisodeTemplatesStackParamList = {
  EpisodeTemplateList: undefined;
  EpisodeTemplateCreate: undefined;
  EpisodeTemplateEdit: { templateId: string };
};

/** Optional deep-link into the Manage tab (e.g. Settings shortcut). */
export type ManageTabParams = {
  initialSegment?: 'episodes' | 'health' | 'food';
};

export type MainTabParamList = {
  Home: undefined;
  SymptomPresets: undefined;
  HealthMarkerPresets: undefined;
  EpisodeTemplates: undefined;
  /** Episodes, standalone health markers, and standalone food diary management. */
  Manage: ManageTabParams | undefined;
};

export type MainStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  /** Episode logging entry: shell until template selection and prompts ship. */
  EpisodeStart: undefined;
  /** Linear symptom prompts for the active episode (preset lines). */
  SymptomPrompt: {
    episodeId: string;
    symptomPresetId: string;
    /** When true, initial step is derived from saved answers (e.g. home “Continue this episode”). */
    resume?: boolean;
  };
  /** Linear health marker prompts for the active episode. */
  HealthMarkerPrompt: {
    episodeId: string;
    /** When true, initial step is derived from saved marker rows. */
    resume?: boolean;
  };
  FoodDiaryEntry: {
    /** Optional episode link for entries logged from inside an episode flow. */
    episodeId?: string;
  };
  /** Log vitals from a preset without an episode (`episode_id` null on saved rows). */
  StandaloneHealthMarkers: undefined;
  Settings: undefined;
};
