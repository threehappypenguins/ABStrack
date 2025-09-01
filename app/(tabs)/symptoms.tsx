// app/(tabs)/symptoms.tsx
import { AccessibleButton } from '@/components/AccessibleButton';
import { QuestionCard } from '@/components/QuestionCard';
import { SeveritySelector } from '@/components/SeveritySelector';
import { VideoRecorder } from '@/components/VideoRecorder';
import { useAuth } from '@/context/AuthContext';
import { dbService } from '@/lib/database';
import { supabase } from '@/lib/supabase';
import { SymptomEntry } from '@/types';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

interface CustomSymptom {
  id: string;
  name: string;
  type: 'boolean' | 'severity' | 'location' | 'video_assessment' | 'carb_entry' | 'notes';
  options?: string[];
  videoPrompt?: string;
  description: string;
}

interface SymptomsScreenProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

type SymptomStage = 'question' | 'severity' | 'video';

export default function SymptomsScreen({ onComplete, onCancel }: SymptomsScreenProps) {
  const { user } = useAuth();
  const [customSymptoms, setCustomSymptoms] = useState<CustomSymptom[]>([]);
  const [currentSymptomIndex, setCurrentSymptomIndex] = useState(0);
  const [currentStage, setCurrentStage] = useState<SymptomStage>('question');
  const [symptomEntries, setSymptomEntries] = useState<SymptomEntry[]>([]);
  const [currentSymptomResponse, setCurrentSymptomResponse] = useState<any>(null);
  const [showVideoRecorder, setShowVideoRecorder] = useState(false);
  const [carbAmount, setCarbAmount] = useState('');
  const [carbDescription, setCarbDescription] = useState('');
  const [notesText, setNotesText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCustomSymptoms();
  }, []);

  const loadCustomSymptoms = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_symptoms')
        .select('*')
        .eq('user_id', user?.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const mappedSymptoms: CustomSymptom[] = (data || []).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        options: item.options,
        videoPrompt: item.video_prompt,
        description: item.description,
      }));

      setCustomSymptoms(mappedSymptoms);
    } catch (error) {
      console.error('Error loading custom symptoms:', error);
      Alert.alert('Error', 'Failed to load symptoms. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  // Web-only message
  if (Platform.OS === 'web') {
    return (
      <View style={styles.webContainer}>
        <Text style={styles.webTitle}>Symptom Assessment</Text>
        <Text style={styles.webMessage}>
          Symptom assessment is only available on mobile devices. 
          Use the mobile app to track your symptoms when you're not feeling well.
        </Text>
        <Text style={styles.webSubMessage}>
          You can use the Settings page to build your custom symptoms questionnaire.
        </Text>
        {onCancel && (
          <AccessibleButton
            title="Close"
            onPress={onCancel}
            variant="secondary"
            style={styles.closeButton}
          />
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading your symptoms...</Text>
        {onCancel && (
          <AccessibleButton
            title="Cancel"
            onPress={onCancel}
            variant="secondary"
            style={styles.cancelButton}
          />
        )}
      </View>
    );
  }

  if (customSymptoms.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No Symptoms Configured</Text>
        <Text style={styles.emptyText}>
          You haven't set up any symptoms to track yet. Use the web app or settings 
          to create your custom symptoms questionnaire.
        </Text>
        <AccessibleButton
          title="Refresh"
          onPress={loadCustomSymptoms}
          variant="primary"
          style={styles.refreshButton}
        />
        {onCancel && (
          <AccessibleButton
            title="Cancel"
            onPress={onCancel}
            variant="secondary"
            style={styles.cancelButton}
          />
        )}
      </View>
    );
  }

  const currentSymptom = customSymptoms[currentSymptomIndex];
  const isLastSymptom = currentSymptomIndex === customSymptoms.length - 1;

  const saveSymptomEntry = async (entryData: Partial<SymptomEntry>) => {
    const entry: SymptomEntry = {
      id: Date.now().toString(),
      userId: user?.id || '',
      symptomId: currentSymptom.id,
      timestamp: new Date().toISOString(),
      synced: false,
      ...entryData,
    };

    await dbService.saveSymptomEntry(entry);
    setSymptomEntries([...symptomEntries, entry]);
  };

  const moveToNextSymptom = () => {
    if (isLastSymptom) {
      onComplete?.();
    } else {
      setCurrentSymptomIndex(currentSymptomIndex + 1);
      setCurrentStage('question');
      setCurrentSymptomResponse(null);
      setCarbAmount('');
      setCarbDescription('');
      setNotesText('');
    }
  };

  const handleSymptomResponse = async (response: any) => {
    switch (currentSymptom.type) {
      case 'boolean':
        if (response === false) {
          await saveSymptomEntry({ value: response });
          moveToNextSymptom();
        } else {
          setCurrentSymptomResponse(response);
          setCurrentStage('severity');
        }
        break;

      case 'carb_entry':
        const amount = parseFloat(carbAmount);
        if (isNaN(amount) || amount < 0) {
          Alert.alert('Invalid Entry', 'Please enter a valid carb amount');
          return;
        }
        await dbService.saveCarbEntry({
          id: Date.now().toString(),
          userId: user?.id || '',
          amount,
          timestamp: new Date().toISOString(),
          description: carbDescription.trim(),
        });
        moveToNextSymptom();
        break;

      case 'notes':
        if (!notesText.trim()) {
          Alert.alert('Empty Notes', 'Please enter some notes or skip this question.');
          return;
        }
        await saveSymptomEntry({ value: notesText.trim() });
        moveToNextSymptom();
        break;

      default:
        await saveSymptomEntry({
          value: response.value || response,
          severity: response.severity,
          location: response.location,
          videoUrl: response.videoUrl,
        });
        moveToNextSymptom();
        break;
    }
  };

  const handleSeveritySelected = async (severity: 'slight' | 'moderate' | 'severe') => {
    if (currentSymptom.videoPrompt) {
      setCurrentSymptomResponse({ ...currentSymptomResponse, severity });
      setCurrentStage('video');
      setShowVideoRecorder(true);
    } else {
      await saveSymptomEntry({ value: currentSymptomResponse, severity });
      moveToNextSymptom();
    }
  };

  const handleVideoRecorded = (videoUri: string) => {
    setShowVideoRecorder(false);
    saveSymptomEntry({
      value: currentSymptomResponse,
      severity: currentSymptomResponse?.severity,
      videoUrl: videoUri,
    });
    moveToNextSymptom();
  };

  const handleVideoSkipped = () => {
    setShowVideoRecorder(false);
    saveSymptomEntry({
      value: currentSymptomResponse,
      severity: currentSymptomResponse?.severity,
    });
    moveToNextSymptom();
  };

  const skipSymptom = () => moveToNextSymptom();

  if (showVideoRecorder && currentSymptom.type === 'boolean' && currentSymptom.videoPrompt) {
    return (
      <VideoRecorder
        prompt={currentSymptom.videoPrompt}
        onVideoRecorded={handleVideoRecorded}
        onComplete={handleVideoSkipped}
        onSkip={handleVideoSkipped}
      />
    );
  }

  const renderSymptomInput = () => {
    if (currentStage === 'severity') {
      return <SeveritySelector onSelect={handleSeveritySelected} />;
    }

    switch (currentSymptom.type) {
      case 'boolean':
        return (
          <View style={styles.booleanOptions}>
            <AccessibleButton title="Yes" onPress={() => handleSymptomResponse(true)} variant="success" style={styles.optionButton} />
            <AccessibleButton title="No" onPress={() => handleSymptomResponse(false)} variant="secondary" style={styles.optionButton} />
          </View>
        );
      case 'location':
        return (
          <View style={styles.locationOptions}>
            {currentSymptom.options?.map((option) => (
              <AccessibleButton key={option} title={option} onPress={() => handleSymptomResponse({ location: option })} variant="secondary" style={styles.locationButton} />
            ))}
          </View>
        );
      case 'carb_entry':
        return (
          <View style={styles.carbEntry}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Carb Amount (grams)</Text>
              <TextInput style={styles.carbInput} value={carbAmount} onChangeText={setCarbAmount} placeholder="0" keyboardType="numeric" />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Description (optional)</Text>
              <TextInput style={styles.carbInput} value={carbDescription} onChangeText={setCarbDescription} placeholder="e.g., Breakfast, Snack, etc." />
            </View>
            <AccessibleButton title="Save Carb Entry" onPress={() => handleSymptomResponse({})} variant="primary" style={styles.carbButton} />
          </View>
        );
      case 'notes':
        return (
          <View style={styles.notesEntry}>
            <TextInput
              style={styles.notesInput}
              value={notesText}
              onChangeText={setNotesText}
              placeholder="Enter your notes here..."
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <AccessibleButton title="Save Notes" onPress={() => handleSymptomResponse({})} variant="primary" style={styles.notesButton} />
          </View>
        );
      default:
        return null;
    }
  };

  const getQuestionText = () => {
    if (currentStage === 'severity') return `How severe is your ${currentSymptom.name.toLowerCase()}?`;
    switch (currentSymptom.type) {
      case 'carb_entry':
        return 'How many carbs have you consumed?';
      case 'notes':
        return currentSymptom.name;
      default:
        return `Are you experiencing ${currentSymptom.name.toLowerCase()}?`;
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Symptom Assessment</Text>
        <Text style={styles.progress}>
          Question {currentSymptomIndex + 1} of {customSymptoms.length}
          {currentStage === 'severity' && ' (Severity)'}
          {currentStage === 'video' && ' (Video)'}
        </Text>
        {onCancel && (
          <AccessibleButton title="Cancel Assessment" onPress={onCancel} variant="secondary" style={styles.cancelHeaderButton} />
        )}
      </View>
      <QuestionCard question={getQuestionText()} onSkip={skipSymptom}>
        <Text style={styles.description}>{currentSymptom.description}</Text>
        {renderSymptomInput()}
      </QuestionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  webContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, backgroundColor: '#F9FAFB' },
  webTitle: { fontSize: 24, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  webMessage: { fontSize: 16, color: '#6B7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  webSubMessage: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  loadingText: { fontSize: 16, color: '#6B7280', marginBottom: 20 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, backgroundColor: '#F9FAFB' },
  emptyTitle: { fontSize: 24, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  emptyText: { fontSize: 16, color: '#6B7280', textAlign: 'center', lineHeight: 24, marginBottom: 32 },
  refreshButton: { minHeight: 56, paddingHorizontal: 32, marginBottom: 16 },
  cancelButton: { minHeight: 56, paddingHorizontal: 32 },
  closeButton: { marginTop: 20, minHeight: 44, paddingHorizontal: 24 },
  header: { paddingHorizontal: 24, paddingTop: 60, paddingBottom: 20 },
  title: { fontSize: 28, fontWeight: '700', color: '#1F2937' },
  progress: { fontSize: 16, color: '#6B7280', marginTop: 4 },
  cancelHeaderButton: { marginTop: 16, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16 },
  description: { fontSize: 14, color: '#6B7280', marginBottom: 20, lineHeight: 20 },
  booleanOptions: { flexDirection: 'row', gap: 12 },
  optionButton: { flex: 1 },
  locationOptions: { gap: 12 },
  locationButton: { minHeight: 48 },
  carbEntry: { gap: 16 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8 },
  carbInput: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: '#1F2937' },
  carbButton: { minHeight: 56 },
  notesEntry: { gap: 16 },
  notesInput: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, color: '#1F2937', minHeight: 120 },
  notesButton: { minHeight: 56 },
});
