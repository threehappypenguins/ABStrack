// components/SymptomsBuilder.tsx
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { Symptom } from '@/types';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AccessibleButton } from './AccessibleButton';

interface SymptomsBuilderProps {
  onClose?: () => void;
}

export function SymptomsBuilder({ onClose }: SymptomsBuilderProps) {
  const { user } = useAuth();
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSymptom, setEditingSymptom] = useState<Symptom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'boolean' as 'boolean' | 'carb_entry' | 'notes',
    description: '',
    videoPrompt: null as string | null,
    options: [''],
  });

  useEffect(() => {
    loadSymptoms();
  }, []);

  const loadSymptoms = async () => {
    if (!user?.id) {
      setError('User not authenticated');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      console.log('Loading symptoms for user:', user.id);
      
      const { data, error: fetchError } = await supabase
        .from('custom_symptoms')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      console.log('Supabase response:', { data, error: fetchError });

      if (fetchError) {
        console.error('Supabase error:', fetchError);
        throw fetchError;
      }

      const mappedSymptoms: Symptom[] = (data || []).map(item => ({
        id: item.id,
        userId: item.user_id,
        name: item.name,
        type: item.type,
        options: item.options,
        videoPrompt: item.video_prompt,
        description: item.description,
        isActive: item.is_active,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }));

      console.log('Mapped symptoms:', mappedSymptoms);
      setSymptoms(mappedSymptoms);
    } catch (error) {
      console.error('Error loading symptoms:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setError(`Failed to load symptoms: ${errorMessage}`);
      Alert.alert('Error', `Failed to load symptoms: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'boolean',
      description: '',
      videoPrompt: null,
      options: [''],
    });
    setEditingSymptom(null);
    setShowAddForm(false);
  };

  const handleSaveSymptom = async () => {
    if (!formData.name.trim() || !formData.description.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (!user?.id) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    try {
      const symptomData = {
        user_id: user.id,
        name: formData.name.trim(),
        type: formData.type,
        description: formData.description.trim(),
        video_prompt: formData.videoPrompt && formData.videoPrompt.trim() ? formData.videoPrompt.trim() : null,
        options: null, // We're removing complex options since everything is now boolean/carb/notes
        is_active: true,
      };

      console.log('Saving symptom data:', symptomData);

      let result;
      if (editingSymptom) {
        result = await supabase
          .from('custom_symptoms')
          .update(symptomData)
          .eq('id', editingSymptom.id)
          .select();
      } else {
        result = await supabase
          .from('custom_symptoms')
          .insert(symptomData)
          .select();
      }

      console.log('Supabase result:', result);

      if (result.error) {
        console.error('Supabase error details:', result.error);
        throw result.error;
      }

      console.log('Successfully saved, reloading symptoms...');
      await loadSymptoms();
      resetForm();
      Alert.alert('Success', `Symptom ${editingSymptom ? 'updated' : 'created'} successfully`);
    } catch (error) {
      console.error('Error saving symptom:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      Alert.alert('Error', `Failed to save symptom: ${errorMessage}`);
    }
  };

  const handleEditSymptom = (symptom: Symptom) => {
    setFormData({
      name: symptom.name,
      type: symptom.type as 'boolean' | 'carb_entry' | 'notes',
      description: symptom.description,
      videoPrompt: symptom.videoPrompt || null,
      options: symptom.options || [''],
    });
    setEditingSymptom(symptom);
    setShowAddForm(true);
  };

  const handleDeleteSymptom = async (symptomId: string) => {
    Alert.alert(
      'Delete Symptom',
      'Are you sure you want to delete this symptom? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('custom_symptoms')
                .delete()
                .eq('id', symptomId);

              if (error) throw error;
              await loadSymptoms();
              Alert.alert('Success', 'Symptom deleted successfully');
            } catch (error) {
              console.error('Error deleting symptom:', error);
              const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
              Alert.alert('Error', `Failed to delete symptom: ${errorMessage}`);
            }
          },
        },
      ]
    );
  };

  const toggleSymptomActive = async (symptom: Symptom) => {
    try {
      const { error } = await supabase
        .from('custom_symptoms')
        .update({ is_active: !symptom.isActive })
        .eq('id', symptom.id);

      if (error) throw error;
      await loadSymptoms();
    } catch (error) {
      console.error('Error toggling symptom:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      Alert.alert('Error', `Failed to update symptom: ${errorMessage}`);
    }
  };

  const addOption = () => {
    setFormData({
      ...formData,
      options: [...formData.options, ''],
    });
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...formData.options];
    newOptions[index] = value;
    setFormData({
      ...formData,
      options: newOptions,
    });
  };

  const removeOption = (index: number) => {
    if (formData.options.length > 1) {
      const newOptions = formData.options.filter((_, i) => i !== index);
      setFormData({
        ...formData,
        options: newOptions,
      });
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading symptoms builder...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Unable to load symptoms builder</Text>
        <Text style={styles.errorText}>{error}</Text>
        <AccessibleButton
          title="Try Again"
          onPress={() => {
            setError(null);
            setLoading(true);
            loadSymptoms();
          }}
          variant="primary"
          style={styles.retryButton}
        />
        {onClose && (
          <AccessibleButton
            title="Close"
            onPress={onClose}
            variant="secondary"
            style={styles.closeButton}
          />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Symptoms Builder</Text>
        <Text style={styles.subtitle}>
          Create custom symptom tracking questions for your assessments
        </Text>
        {onClose && (
          <AccessibleButton
            title="Close"
            onPress={onClose}
            variant="secondary"
            style={styles.closeButton}
          />
        )}
      </View>

      {/* Add New Symptom Button */}
      {!showAddForm && (
        <View style={styles.addButtonContainer}>
          <AccessibleButton
            title="Add New Symptom"
            onPress={() => setShowAddForm(true)}
            variant="primary"
            style={styles.addButton}
          />
        </View>
      )}

      {/* Add/Edit Form */}
      {showAddForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {editingSymptom ? 'Edit Symptom' : 'Add New Symptom'}
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Symptom Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="e.g., Headache, Nausea, Facial Droop"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Question Type *</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
                style={styles.picker}
              >
                <Picker.Item label="Yes/No Symptom Question" value="boolean" />
                <Picker.Item label="Carb Count Entry" value="carb_entry" />
                <Picker.Item label="Miscellaneous Notes" value="notes" />
              </Picker>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.description}
              onChangeText={(text) => setFormData({ ...formData, description: text })}
              placeholder={
                formData.type === 'boolean' 
                  ? "e.g., Left side facial weakness or drooping"
                  : formData.type === 'carb_entry'
                  ? "Instructions for entering carb count"
                  : "Instructions for adding notes"
              }
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Boolean symptom options */}
          {formData.type === 'boolean' && (
            <>
              <View style={styles.inputGroup}>
                <View style={styles.checkboxRow}>
                  <Text style={styles.label}>Options for this symptom:</Text>
                </View>
                
                <View style={styles.checkboxRow}>
                  <View style={styles.checkbox}>
                    <Text style={styles.checkboxLabel}>✓ Ask for severity rating (Slight, Moderate, Severe)</Text>
                  </View>
                </View>

                <View style={styles.checkboxRow}>
                  <View style={styles.checkbox}>
                    <Text style={styles.checkboxLabel}>
                      {formData.videoPrompt ? '✓' : '☐'} Include video assessment
                    </Text>
                  </View>
                </View>

                {(formData.videoPrompt || formData.videoPrompt === '') && (
                  <View style={styles.indentedGroup}>
                    <Text style={styles.label}>Video Prompt *</Text>
                    <TextInput
                      style={styles.input}
                      value={formData.videoPrompt}
                      onChangeText={(text) => setFormData({ ...formData, videoPrompt: text })}
                      placeholder="e.g., Please smile for the camera, or Say 'The early bird catches the worm'"
                    />
                  </View>
                )}

                <AccessibleButton
                  title={formData.videoPrompt !== null ? "Remove Video Assessment" : "Add Video Assessment"}
                  onPress={() => setFormData({ 
                    ...formData, 
                    videoPrompt: formData.videoPrompt !== null ? null : ''
                  })}
                  variant="secondary"
                  style={styles.toggleVideoButton}
                />
              </View>
            </>
          )}

          {/* Carb entry note */}
          {formData.type === 'carb_entry' && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                This will prompt the user to enter a carb count in grams with an optional description.
              </Text>
            </View>
          )}

          {/* Notes entry note */}
          {formData.type === 'notes' && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                This will provide a text area for the user or caretaker to add miscellaneous notes.
              </Text>
            </View>
          )}

          <View style={styles.formActions}>
            <AccessibleButton
              title="Cancel"
              onPress={resetForm}
              variant="secondary"
              style={styles.formButton}
            />
            <AccessibleButton
              title={editingSymptom ? 'Update' : 'Create'}
              onPress={handleSaveSymptom}
              variant="primary"
              style={styles.formButton}
            />
          </View>
        </View>
      )}

      {/* Existing Symptoms List */}
      <View style={styles.symptomsSection}>
        <Text style={styles.sectionTitle}>Your Custom Symptoms ({symptoms.length})</Text>
        
        {symptoms.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No custom symptoms created yet. Add your first symptom to start tracking.
            </Text>
          </View>
        ) : (
          symptoms.map((symptom) => (
            <View key={symptom.id} style={styles.symptomCard}>
              <View style={styles.symptomHeader}>
                <View style={styles.symptomInfo}>
                  <Text style={styles.symptomName}>{symptom.name}</Text>
                  <Text style={styles.symptomType}>
                    {symptom.type.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
                <View style={styles.symptomActions}>
                  <AccessibleButton
                    title={symptom.isActive ? 'Active' : 'Inactive'}
                    onPress={() => toggleSymptomActive(symptom)}
                    variant={symptom.isActive ? 'success' : 'secondary'}
                    style={styles.statusButton}
                  />
                </View>
              </View>
              
              <Text style={styles.symptomDescription}>{symptom.description}</Text>
              
              {symptom.videoPrompt && (
                <Text style={styles.videoPromptText}>
                  Video prompt: "{symptom.videoPrompt}"
                </Text>
              )}
              
              {symptom.options && (
                <Text style={styles.optionsText}>
                  Options: {symptom.options.join(', ')}
                </Text>
              )}

              <View style={styles.symptomCardActions}>
                <AccessibleButton
                  title="Edit"
                  onPress={() => handleEditSymptom(symptom)}
                  variant="secondary"
                  style={styles.cardActionButton}
                />
                <AccessibleButton
                  title="Delete"
                  onPress={() => handleDeleteSymptom(symptom.id)}
                  variant="danger"
                  style={styles.cardActionButton}
                />
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#DC2626',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  retryButton: {
    marginBottom: 12,
    minHeight: 44,
    paddingHorizontal: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
    lineHeight: 22,
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'flex-start',
  },
  addButtonContainer: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  addButton: {
    minHeight: 56,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#1F2937',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  pickerContainer: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    overflow: 'hidden',
  },
  picker: {
    height: 56,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  optionInput: {
    flex: 1,
  },
  removeButton: {
    minWidth: 80,
    minHeight: 44,
  },
  addOptionButton: {
    marginTop: 8,
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  formButton: {
    flex: 1,
    minHeight: 56,
  },
  symptomsSection: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    padding: 40,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  symptomCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  symptomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  symptomInfo: {
    flex: 1,
  },
  symptomName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  symptomType: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },
  symptomActions: {
    marginLeft: 12,
  },
  statusButton: {
    minWidth: 80,
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  symptomDescription: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginBottom: 8,
  },
  videoPromptText: {
    fontSize: 14,
    color: '#2563EB',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  optionsText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  symptomCardActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  cardActionButton: {
    flex: 1,
    minHeight: 44,
  },
  checkboxRow: {
    marginBottom: 12,
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxLabel: {
    fontSize: 16,
    color: '#374151',
    marginLeft: 8,
  },
  indentedGroup: {
    marginLeft: 16,
    marginTop: 12,
  },
  toggleVideoButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  infoBox: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#3730A3',
    lineHeight: 20,
  },
});