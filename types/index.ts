// types/index.ts
export interface User {
  id: string;
  email: string;
  role: 'patient' | 'doctor';
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface BACReading {
  id: string;
  userId: string;
  value: number;
  unit: 'mg/dL' | 'mmol/L';
  timestamp: string;
  source: 'manual' | 'device';
  deviceId?: string;
  synced: boolean;
}

export interface Symptom {
  id: string;
  userId: string;
  name: string;
  type:
    | 'boolean'
    | 'severity'
    | 'location'
    | 'video_assessment'
    | 'carb_entry'
    | 'notes'; // merged extra types
  options?: string[];
  videoPrompt?: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SymptomEntry {
  id: string;
  userId: string;
  symptomId: string;
  value?: string | number;  // made optional
  severity?: 'slight' | 'moderate' | 'severe';
  location?: string;
  videoUrl?: string;
  notes?: string;
  timestamp: string;
  synced: boolean;
}

export interface CarbEntry {
  id: string;
  userId: string;
  amount: number;
  timestamp: string;
  description?: string; // made optional for flexibility
  synced: boolean;
}

export interface SessionEntry {
  id: string;
  userId: string;
  bacReading?: BACReading;
  symptoms: SymptomEntry[];
  carbEntries: CarbEntry[];
  notes: string;
  timestamp: string;
  synced: boolean;
}

export interface ConversionUtils {
  mgDLToMmolL: (value: number) => number;
  mmolLToMgDL: (value: number) => number;
}
