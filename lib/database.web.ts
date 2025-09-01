// lib/database.web.ts - Web-specific implementation (Supabase only)
import { BACReading, SymptomEntry } from '@/types';
import { supabase } from './supabase';

class DatabaseService {
  async initializeLocalDB() {
    // No initialization needed on web - using Supabase directly
    console.log('Web platform - using direct Supabase access');
  }

  async saveBACReading(reading: BACReading) {
    try {
      const { error } = await supabase
        .from('bac_readings')
        .upsert({
          id: reading.id,
          user_id: reading.userId,
          value: reading.value,
          unit: reading.unit,
          timestamp: reading.timestamp,
          source: reading.source,
          device_id: reading.deviceId,
        });

      if (error) throw error;
      console.log('BAC reading saved to Supabase (web)');
    } catch (error) {
      console.error('Error saving BAC reading:', error);
      throw error;
    }
  }

  async saveSymptomEntry(entry: SymptomEntry) {
    try {
      const { error } = await supabase
        .from('symptom_entries')
        .upsert({
          id: entry.id,
          user_id: entry.userId,
          symptom_id: entry.symptomId,
          value: typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
          severity: entry.severity ?? null,
          location: entry.location ?? null,
          video_url: entry.videoUrl ?? null,
          timestamp: entry.timestamp,
        });

      if (error) throw error;
      console.log('Symptom entry saved to Supabase (web)');
    } catch (error) {
      console.error('Error saving symptom entry:', error);
      throw error;
    }
  }

  async saveCarbEntry(entry: {
    id: string;
    userId: string;
    amount: number;
    timestamp: string;
    description?: string;
  }) {
    try {
      const { error } = await supabase
        .from('carb_entries')
        .upsert({
          id: entry.id,
          user_id: entry.userId,
          amount: entry.amount,
          timestamp: entry.timestamp,
          description: entry.description ?? null,
        });

      if (error) throw error;
      console.log('Carb entry saved to Supabase (web)');
    } catch (error) {
      console.error('Error saving carb entry:', error);
      throw error;
    }
  }

  async saveSessionEntry(entry: {
    id: string;
    userId: string;
    bacReadingId?: string;
    notes?: string;
    timestamp: string;
  }) {
    try {
      const { error } = await supabase
        .from('session_entries')
        .upsert({
          id: entry.id,
          user_id: entry.userId,
          bac_reading_id: entry.bacReadingId || null,
          notes: entry.notes,
          timestamp: entry.timestamp,
        });

      if (error) throw error;
      console.log('Session entry saved to Supabase (web)');
    } catch (error) {
      console.error('Error saving session entry:', error);
      throw error;
    }
  }

  async saveCustomSymptom(symptom: {
    id: string;
    userId: string;
    name: string;
    type: string;
    options?: string[];
    videoPrompt?: string;
    description: string;
    isActive: boolean;
  }) {
    try {
      const { error } = await supabase
        .from('custom_symptoms')
        .upsert({
          id: symptom.id,
          user_id: symptom.userId,
          name: symptom.name,
          type: symptom.type,
          options: symptom.options || null,
          video_prompt: symptom.videoPrompt || null,
          description: symptom.description,
          is_active: symptom.isActive,
        });

      if (error) throw error;
      console.log('Custom symptom saved to Supabase (web)');
    } catch (error) {
      console.error('Error saving custom symptom:', error);
      throw error;
    }
  }

  async getBACReadings(userId: string, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('bac_readings')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching BAC readings:', error);
      return [];
    }
  }

  async getSymptomEntries(userId: string, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('symptom_entries')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching symptom entries:', error);
      return [];
    }
  }

  async getCarbEntries(userId: string, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('carb_entries')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching carb entries:', error);
      return [];
    }
  }

  async getCustomSymptoms(userId: string) {
    try {
      const { data, error } = await supabase
        .from('custom_symptoms')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Transform the data to match the expected format
      return (data || []).map((symptom: any) => ({
        id: symptom.id,
        user_id: symptom.user_id,
        name: symptom.name,
        type: symptom.type,
        options: symptom.options,
        video_prompt: symptom.video_prompt,
        description: symptom.description,
        is_active: symptom.is_active,
        created_at: symptom.created_at,
        updated_at: symptom.updated_at,
      }));
    } catch (error) {
      console.error('Error fetching custom symptoms:', error);
      return [];
    }
  }

  // These methods are no-ops on web since we don't have local storage
  async syncToSupabase() {
    // No sync needed on web - data is already in Supabase
    console.log('No sync needed on web platform');
  }

  async getSyncStatus() {
    // No sync status on web - everything is already synced
    return { 
      bacReadings: 0, 
      symptomEntries: 0, 
      carbEntries: 0, 
      sessionEntries: 0, 
      customSymptoms: 0, 
      total: 0 
    };
  }
}

export const dbService = new DatabaseService();