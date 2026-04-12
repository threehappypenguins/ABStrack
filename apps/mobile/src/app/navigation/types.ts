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

export type MainTabParamList = {
  Home: undefined;
  SymptomPresets: undefined;
  HealthMarkerPresets: undefined;
};

export type MainStackParamList = {
  MainTabs: undefined;
  Settings: undefined;
};
