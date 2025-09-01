// app/(tabs)/settings.tsx
import { AccessibleButton } from '@/components/AccessibleButton';
import { SymptomsBuilder } from '@/components/SymptomsBuilder';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { dbService } from '@/lib/database';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [showSymptomsBuilder, setShowSymptomsBuilder] = useState(false);
  const { 
    bacUnit, 
    setBacUnit, 
    speechEnabled, 
    setSpeechEnabled,
    highContrastMode,
    setHighContrastMode,
    textSize,
    setTextSize 
  } = useSettings();

  const handleSignOut = async () => {
    await signOut();
  };

  if (showSymptomsBuilder) {
    return (
      <SymptomsBuilder onClose={() => setShowSymptomsBuilder(false)} />
    );
  }

  const settingSections = [
    ...(Platform.OS === 'web' ? [{
      title: 'Symptoms Management',
      items: [
        {
          label: 'Symptoms Builder',
          type: 'action' as const,
          onPress: () => setShowSymptomsBuilder(true),
        },
      ],
    }] : []),
    {
      title: 'Measurement Units',
      items: [
        {
          label: 'BAC Unit',
          value: bacUnit,
          type: 'toggle' as const,
          options: ['mg/dL', 'mmol/L'],
          onPress: () => setBacUnit(bacUnit === 'mg/dL' ? 'mmol/L' : 'mg/dL'),
        },
      ],
    },
    {
      title: 'Accessibility',
      items: [
        {
          label: 'Read Questions Aloud',
          value: speechEnabled,
          type: 'switch' as const,
          onToggle: setSpeechEnabled,
        },
        {
          label: 'High Contrast Mode',
          value: highContrastMode,
          type: 'switch' as const,
          onToggle: setHighContrastMode,
        },
        {
          label: 'Text Size',
          value: textSize,
          type: 'options' as const,
          options: ['small', 'medium', 'large'],
          onPress: () => {
            const sizes = ['small', 'medium', 'large'] as const;
            const currentIndex = sizes.indexOf(textSize);
            const nextIndex = (currentIndex + 1) % sizes.length;
            setTextSize(sizes[nextIndex]);
          },
        },
      ],
    },
    ...(Platform.OS !== 'web' ? [{
      title: 'Data Management',
      items: [
        {
          label: 'Sync Data Now',
          type: 'action' as const,
          onPress: async () => {
            // Trigger manual sync
            await dbService.syncToSupabase();
            alert('Data synchronized successfully');
          },
        },
        {
          label: 'Export My Data',
          type: 'action' as const,
          onPress: () => {
            // Export functionality
            alert('Data export feature coming soon');
          },
        },
      ],
    }] : []),
  ];

  const filteredSections = settingSections.filter(section => {
    if (section.title === 'Data Management') {
      return Platform.OS !== 'web';
    }
    return true;
  });

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      {/* User Profile */}
      <View style={styles.profileCard}>
        <View style={styles.profileIcon}>
          <Ionicons name="person" size={24} />
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>
            {user?.firstName} {user?.lastName}
          </Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
          <Text style={styles.profileRole}>
            {user?.role === 'doctor' ? 'Healthcare Provider' : 'Patient'}
          </Text>
        </View>
      </View>

      {/* Settings Sections */}
      {filteredSections.map((section, sectionIndex) => (
        <View key={sectionIndex} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          
          {section.items.map((item, itemIndex) => (
            <View key={itemIndex} style={styles.settingItem}>
              <View style={styles.settingLabel}>
                <Text style={styles.settingText}>{item.label}</Text>
                {(item.type === 'toggle' || item.type === 'options') && (
                  <Text style={styles.settingValue}>{item.value as string}</Text>
                )}
              </View>

              {item.type === 'switch' && (
                <Switch
                  value={item.value as boolean}
                  onValueChange={item.onToggle}
                  trackColor={{ false: '#D1D5DB', true: '#93C5FD' }}
                  thumbColor={item.value ? '#2563EB' : '#F3F4F6'}
                />
              )}

              {item.type === 'toggle' && (
                <AccessibleButton
                  title={item.value as string}
                  onPress={item.onPress!}
                  variant="secondary"
                  style={styles.toggleButton}
                />
              )}

              {item.type === 'options' && (
                <AccessibleButton
                  title={item.value as string}
                  onPress={item.onPress!}
                  variant="secondary"
                  style={styles.toggleButton}
                />
              )}

              {item.type === 'action' && (
                <AccessibleButton
                  title="Open"
                  onPress={item.onPress!}
                  variant="primary"
                  style={styles.actionButton}
                />
              )}
            </View>
          ))}
        </View>
      ))}

      {/* Sign Out */}
      <View style={styles.signOutSection}>
        <AccessibleButton
          title="Sign Out"
          onPress={handleSignOut}
          variant="danger"
          style={styles.signOutButton}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 20,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  profileIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  profileEmail: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  profileRole: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '500',
    marginTop: 4,
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
    marginLeft: 4,
  },
  settingItem: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  settingLabel: {
    flex: 1,
  },
  settingText: {
    fontSize: 16,
    color: '#1F2937',
    fontWeight: '500',
  },
  settingValue: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  toggleButton: {
    minWidth: 80,
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  actionButton: {
    minWidth: 100,
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  signOutSection: {
    paddingHorizontal: 16,
    marginBottom: 40,
  },
  signOutButton: {
    minHeight: 56,
  },
});