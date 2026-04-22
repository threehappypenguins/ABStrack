/**
 * Param lists for authenticated mobile navigation (tabs + stack overlays).
 */

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

export type MainTabParamList = {
  Home: undefined;
  SymptomPresets: undefined;
  HealthMarkerPresets: undefined;
  EpisodeTemplates: undefined;
};

export type MainStackParamList = {
  MainTabs: undefined;
  /** Active and recent episodes with resume for the in-progress row. */
  Episodes: undefined;
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
  Settings: undefined;
};
