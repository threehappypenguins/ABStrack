import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface SettingsContextType {
  bacUnit: 'mg/dL' | 'mmol/L';
  setBacUnit: (unit: 'mg/dL' | 'mmol/L') => void;
  speechEnabled: boolean;
  setSpeechEnabled: (enabled: boolean) => void;
  highContrastMode: boolean;
  setHighContrastMode: (enabled: boolean) => void;
  textSize: 'small' | 'medium' | 'large';
  setTextSize: (size: 'small' | 'medium' | 'large') => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [bacUnit, setBacUnitState] = useState<'mg/dL' | 'mmol/L'>('mg/dL');
  const [speechEnabled, setSpeechEnabledState] = useState(true);
  const [highContrastMode, setHighContrastModeState] = useState(false);
  const [textSize, setTextSizeState] = useState<'small' | 'medium' | 'large'>('medium');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await AsyncStorage.getItem('app_settings');
      if (settings) {
        const parsedSettings = JSON.parse(settings);
        setBacUnitState(parsedSettings.bacUnit || 'mg/dL');
        setSpeechEnabledState(parsedSettings.speechEnabled !== false);
        setHighContrastModeState(parsedSettings.highContrastMode || false);
        setTextSizeState(parsedSettings.textSize || 'medium');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async (newSettings: any) => {
    try {
      await AsyncStorage.setItem('app_settings', JSON.stringify(newSettings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const setBacUnit = (unit: 'mg/dL' | 'mmol/L') => {
    setBacUnitState(unit);
    saveSettings({ bacUnit: unit, speechEnabled, highContrastMode, textSize });
  };

  const setSpeechEnabled = (enabled: boolean) => {
    setSpeechEnabledState(enabled);
    saveSettings({ bacUnit, speechEnabled: enabled, highContrastMode, textSize });
  };

  const setHighContrastMode = (enabled: boolean) => {
    setHighContrastModeState(enabled);
    saveSettings({ bacUnit, speechEnabled, highContrastMode: enabled, textSize });
  };

  const setTextSize = (size: 'small' | 'medium' | 'large') => {
    setTextSizeState(size);
    saveSettings({ bacUnit, speechEnabled, highContrastMode, textSize: size });
  };

  return (
    <SettingsContext.Provider value={{
      bacUnit,
      setBacUnit,
      speechEnabled,
      setSpeechEnabled,
      highContrastMode,
      setHighContrastMode,
      textSize,
      setTextSize,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
};