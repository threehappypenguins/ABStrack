// lib/database.native.ts - Mobile-specific implementation
import { BACReading, SymptomEntry } from '@/types';
import * as SQLite from 'expo-sqlite';
import { supabase } from './supabase';

// Local database types
interface LocalBACReading {
  id: string;
  user_id: string;
  value: number;
  unit: string;
  timestamp: string;
  source: string;
  device_id: string;
  synced: number;
  created_at: string;
}

interface LocalSymptomEntry {
  id: string;
  user_id: string;
  symptom_id: string;
  value: string;
  severity: string;
  location: string;
  video_url: string;
  timestamp: string;
  synced: number;
  created_at: string;
}

interface LocalCarbEntry {
  id: string;
  user_id: string;
  amount: number;
  timestamp: string;
  description: string;
  synced: number;
  created_at: string;
}

interface LocalSessionEntry {
  id: string;
  user_id: string;
  bac_reading_id: string;
  notes: string;
  timestamp: string;
  synced: number;
  created_at: string;
}

interface LocalCustomSymptom {
  id: string;
  user_id: string;
  name: string;
  type: string;
  options: string;
  video_prompt: string;
  description: string;
  is_active: number;
  synced: number;
  created_at: string;
}

interface CountResult {
  count: number;
}

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;
  private isInitialized = false;

  async initializeLocalDB() {
    if (this.isInitialized) return;
    
    try {
      this.db = await SQLite.openDatabaseAsync('medical_tracker.db');
      
      await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS bac_readings (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          value REAL,
          unit TEXT,
          timestamp TEXT,
          source TEXT,
          device_id TEXT,
          synced INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS symptom_entries (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          symptom_id TEXT,
          value TEXT,
          severity TEXT,
          location TEXT,
          video_url TEXT,
          timestamp TEXT,
          synced INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS carb_entries (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          amount REAL,
          timestamp TEXT,
          description TEXT,
          synced INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS session_entries (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          bac_reading_id TEXT,
          notes TEXT,
          timestamp TEXT,
          synced INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS custom_symptoms (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          name TEXT,
          type TEXT,
          options TEXT,
          video_prompt TEXT,
          description TEXT,
          is_active INTEGER DEFAULT 1,
          synced INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_bac_user ON bac_readings(user_id);
        CREATE INDEX IF NOT EXISTS idx_symptom_user ON symptom_entries(user_id);
        CREATE INDEX IF NOT EXISTS idx_carb_user ON carb_entries(user_id);
        CREATE INDEX IF NOT EXISTS idx_session_user ON session_entries(user_id);
        CREATE INDEX IF NOT EXISTS idx_custom_symptoms_user ON custom_symptoms(user_id);
      `);
      
      this.isInitialized = true;
      console.log('Local database initialized successfully');
      
      // Auto-sync on initialization if online
      this.syncToSupabase();
    } catch (error) {
      console.error('Error initializing local database:', error);
      throw error;
    }
  }

  async saveBACReading(reading: BACReading) {
    await this.initializeLocalDB();
    
    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO bac_readings (id, user_id, value, unit, timestamp, source, device_id, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [reading.id, reading.userId, reading.value, reading.unit, reading.timestamp, reading.source, reading.deviceId || '', 0]
      );

      await this.syncBACReading(reading.id);
      console.log('BAC reading saved locally');
    } catch (error) {
      console.error('Error saving BAC reading:', error);
      throw error;
    }
  }

  async saveSymptomEntry(entry: SymptomEntry) {
    await this.initializeLocalDB();
    
    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO symptom_entries (id, user_id, symptom_id, value, severity, location, video_url, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          entry.id,
          entry.userId,
          entry.symptomId,
          typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value),
          entry.severity ?? null,
          entry.location ?? null,
          entry.videoUrl ?? null,
          entry.timestamp,
          0,
        ]
      );

      await this.syncSymptomEntry(entry.id);
      console.log('Symptom entry saved locally');
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
    await this.initializeLocalDB();
    
    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO carb_entries (id, user_id, amount, timestamp, description, synced) VALUES (?, ?, ?, ?, ?, ?)',
        [entry.id, entry.userId, entry.amount, entry.timestamp, entry.description ?? null, 0]
      );

      await this.syncCarbEntry(entry.id);
      console.log('Carb entry saved locally');
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
    await this.initializeLocalDB();
    
    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO session_entries (id, user_id, bac_reading_id, notes, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?)',
        [entry.id, entry.userId, entry.bacReadingId || '', entry.notes || '', entry.timestamp, 0]
      );

      await this.syncSessionEntry(entry.id);
      console.log('Session entry saved locally');
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
    await this.initializeLocalDB();
    
    try {
      await this.db!.runAsync(
        'INSERT OR REPLACE INTO custom_symptoms (id, user_id, name, type, options, video_prompt, description, is_active, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          symptom.id, 
          symptom.userId, 
          symptom.name, 
          symptom.type, 
          symptom.options ? JSON.stringify(symptom.options) : '', 
          symptom.videoPrompt || '', 
          symptom.description, 
          symptom.isActive ? 1 : 0, 
          0
        ]
      );

      await this.syncCustomSymptom(symptom.id);
      console.log('Custom symptom saved locally');
    } catch (error) {
      console.error('Error saving custom symptom:', error);
      throw error;
    }
  }

  // Local data retrieval methods
  async getBACReadings(userId: string, limit = 100): Promise<LocalBACReading[]> {
    await this.initializeLocalDB();
    
    try {
      const readings = await this.db!.getAllAsync(
        'SELECT * FROM bac_readings WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
        [userId, limit]
      ) as LocalBACReading[];
      return readings;
    } catch (error) {
      console.error('Error fetching BAC readings:', error);
      return [];
    }
  }

  async getSymptomEntries(userId: string, limit = 100): Promise<LocalSymptomEntry[]> {
    await this.initializeLocalDB();
    
    try {
      const entries = await this.db!.getAllAsync(
        'SELECT * FROM symptom_entries WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
        [userId, limit]
      ) as LocalSymptomEntry[];
      return entries;
    } catch (error) {
      console.error('Error fetching symptom entries:', error);
      return [];
    }
  }

  async getCarbEntries(userId: string, limit = 100): Promise<LocalCarbEntry[]> {
    await this.initializeLocalDB();
    
    try {
      const entries = await this.db!.getAllAsync(
        'SELECT * FROM carb_entries WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
        [userId, limit]
      ) as LocalCarbEntry[];
      return entries;
    } catch (error) {
      console.error('Error fetching carb entries:', error);
      return [];
    }
  }

  async getCustomSymptoms(userId: string): Promise<any[]> {
    await this.initializeLocalDB();
    
    try {
      const symptoms = await this.db!.getAllAsync(
        'SELECT * FROM custom_symptoms WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC',
        [userId]
      );
      return symptoms.map((symptom: any) => ({
        ...symptom,
        options: symptom.options ? JSON.parse(symptom.options) : null,
        is_active: symptom.is_active === 1,
      }));
    } catch (error) {
      console.error('Error fetching custom symptoms:', error);
      return [];
    }
  }

  // Individual sync methods
  private async syncBACReading(id: string) {
    try {
      const reading = await this.db!.getFirstAsync(
        'SELECT * FROM bac_readings WHERE id = ? AND synced = 0',
        [id]
      ) as LocalBACReading | null;
      
      if (!reading) return;

      const { error } = await supabase
        .from('bac_readings')
        .upsert({
          id: reading.id,
          user_id: reading.user_id,
          value: reading.value,
          unit: reading.unit,
          timestamp: reading.timestamp,
          source: reading.source,
          device_id: reading.device_id,
        });

      if (!error) {
        await this.db!.runAsync('UPDATE bac_readings SET synced = 1 WHERE id = ?', [id]);
        console.log('BAC reading synced to Supabase');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log('Sync failed (offline?), will retry later:', errorMessage);
    }
  }

  private async syncSymptomEntry(id: string) {
    try {
      const entry = await this.db!.getFirstAsync(
        'SELECT * FROM symptom_entries WHERE id = ? AND synced = 0',
        [id]
      ) as LocalSymptomEntry | null;
      
      if (!entry) return;

      const { error } = await supabase
        .from('symptom_entries')
        .upsert({
          id: entry.id,
          user_id: entry.user_id,
          symptom_id: entry.symptom_id,
          value: entry.value,
          severity: entry.severity,
          location: entry.location,
          video_url: entry.video_url,
          timestamp: entry.timestamp,
        });

      if (!error) {
        await this.db!.runAsync('UPDATE symptom_entries SET synced = 1 WHERE id = ?', [id]);
        console.log('Symptom entry synced to Supabase');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log('Sync failed (offline?), will retry later:', errorMessage);
    }
  }

  private async syncCarbEntry(id: string) {
    try {
      const entry = await this.db!.getFirstAsync(
        'SELECT * FROM carb_entries WHERE id = ? AND synced = 0',
        [id]
      ) as LocalCarbEntry | null;
      
      if (!entry) return;

      const { error } = await supabase
        .from('carb_entries')
        .upsert({
          id: entry.id,
          user_id: entry.user_id,
          amount: entry.amount,
          timestamp: entry.timestamp,
          description: entry.description,
        });

      if (!error) {
        await this.db!.runAsync('UPDATE carb_entries SET synced = 1 WHERE id = ?', [id]);
        console.log('Carb entry synced to Supabase');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log('Sync failed (offline?), will retry later:', errorMessage);
    }
  }

  private async syncSessionEntry(id: string) {
    try {
      const entry = await this.db!.getFirstAsync(
        'SELECT * FROM session_entries WHERE id = ? AND synced = 0',
        [id]
      ) as LocalSessionEntry | null;
      
      if (!entry) return;

      const { error } = await supabase
        .from('session_entries')
        .upsert({
          id: entry.id,
          user_id: entry.user_id,
          bac_reading_id: entry.bac_reading_id || null,
          notes: entry.notes,
          timestamp: entry.timestamp,
        });

      if (!error) {
        await this.db!.runAsync('UPDATE session_entries SET synced = 1 WHERE id = ?', [id]);
        console.log('Session entry synced to Supabase');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log('Sync failed (offline?), will retry later:', errorMessage);
    }
  }

  private async syncCustomSymptom(id: string) {
    try {
      const symptom = await this.db!.getFirstAsync(
        'SELECT * FROM custom_symptoms WHERE id = ? AND synced = 0',
        [id]
      ) as LocalCustomSymptom | null;
      
      if (!symptom) return;

      const { error } = await supabase
        .from('custom_symptoms')
        .upsert({
          id: symptom.id,
          user_id: symptom.user_id,
          name: symptom.name,
          type: symptom.type,
          options: symptom.options ? JSON.parse(symptom.options) : null,
          video_prompt: symptom.video_prompt,
          description: symptom.description,
          is_active: symptom.is_active === 1,
        });

      if (!error) {
        await this.db!.runAsync('UPDATE custom_symptoms SET synced = 1 WHERE id = ?', [id]);
        console.log('Custom symptom synced to Supabase');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log('Sync failed (offline?), will retry later:', errorMessage);
    }
  }

  // Full sync method - call this when app comes online
  async syncToSupabase() {
    if (!this.db) await this.initializeLocalDB();

    try {
      console.log('Starting full sync to Supabase...');
      
      const bacReadings = await this.db!.getAllAsync('SELECT * FROM bac_readings WHERE synced = 0') as LocalBACReading[];
      for (const reading of bacReadings) {
        await this.syncBACReading(reading.id);
      }

      const symptomEntries = await this.db!.getAllAsync('SELECT * FROM symptom_entries WHERE synced = 0') as LocalSymptomEntry[];
      for (const entry of symptomEntries) {
        await this.syncSymptomEntry(entry.id);
      }

      const carbEntries = await this.db!.getAllAsync('SELECT * FROM carb_entries WHERE synced = 0') as LocalCarbEntry[];
      for (const entry of carbEntries) {
        await this.syncCarbEntry(entry.id);
      }

      const sessionEntries = await this.db!.getAllAsync('SELECT * FROM session_entries WHERE synced = 0') as LocalSessionEntry[];
      for (const entry of sessionEntries) {
        await this.syncSessionEntry(entry.id);
      }

      const customSymptoms = await this.db!.getAllAsync('SELECT * FROM custom_symptoms WHERE synced = 0') as LocalCustomSymptom[];
      for (const symptom of customSymptoms) {
        await this.syncCustomSymptom(symptom.id);
      }

      console.log('Full sync completed');
    } catch (error) {
      console.error('Full sync error:', error);
    }
  }

  // Get sync status
  async getSyncStatus() {
    await this.initializeLocalDB();
    
    try {
      const unsyncedBAC = await this.db!.getAllAsync('SELECT COUNT(*) as count FROM bac_readings WHERE synced = 0') as CountResult[];
      const unsyncedSymptomEntries = await this.db!.getAllAsync('SELECT COUNT(*) as count FROM symptom_entries WHERE synced = 0') as CountResult[];
      const unsyncedCarbs = await this.db!.getAllAsync('SELECT COUNT(*) as count FROM carb_entries WHERE synced = 0') as CountResult[];
      const unsyncedSessions = await this.db!.getAllAsync('SELECT COUNT(*) as count FROM session_entries WHERE synced = 0') as CountResult[];
      const unsyncedCustomSymptoms = await this.db!.getAllAsync('SELECT COUNT(*) as count FROM custom_symptoms WHERE synced = 0') as CountResult[];

      return {
        bacReadings: unsyncedBAC[0]?.count || 0,
        symptomEntries: unsyncedSymptomEntries[0]?.count || 0,
        carbEntries: unsyncedCarbs[0]?.count || 0,
        sessionEntries: unsyncedSessions[0]?.count || 0,
        customSymptoms: unsyncedCustomSymptoms[0]?.count || 0,
        total: (unsyncedBAC[0]?.count || 0) + (unsyncedSymptomEntries[0]?.count || 0) + (unsyncedCarbs[0]?.count || 0) + (unsyncedSessions[0]?.count || 0) + (unsyncedCustomSymptoms[0]?.count || 0)
      };
    } catch (error) {
      console.error('Error getting sync status:', error);
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
}

export const dbService = new DatabaseService();