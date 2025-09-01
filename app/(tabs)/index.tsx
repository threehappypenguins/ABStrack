// app/(tabs)/index.tsx
import { AccessibleButton } from '@/components/AccessibleButton';
import { QuestionCard } from '@/components/QuestionCard';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { bacTrackService } from '@/lib/bactrack';
import { ConversionService } from '@/lib/conversions';
import { dbService } from '@/lib/database';
import { BACReading } from '@/types';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import SymptomsScreen from './symptoms';

export default function DashboardScreen() {
  const { user } = useAuth();
  const { bacUnit } = useSettings();
  const router = useRouter();
  const [currentBACReading, setCurrentBACReading] = useState<BACReading | null>(null);
  const [showBACEntry, setShowBACEntry] = useState(false);
  const [manualBAC, setManualBAC] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [showSymptomsModal, setShowSymptomsModal] = useState(false);

  useEffect(() => {
    // Initialize local database only on mobile
    if (Platform.OS !== 'web') {
      dbService.initializeLocalDB();
    }
  }, []);

  const handleBluetoothConnect = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Bluetooth connectivity is only available on mobile devices');
      return;
    }

    setIsConnecting(true);
    try {
      const permissionGranted = await bacTrackService.requestPermissions();
      
      if (!permissionGranted) {
        Alert.alert('Permission Required', 'Bluetooth permission is required to connect to BACtrack device');
        return;
      }

      const devices = await bacTrackService.scanForDevices();
      
      if (devices.length === 0) {
        Alert.alert('No Devices Found', 'No BACtrack devices found nearby. Make sure your device is powered on and in pairing mode.');
        return;
      }

      const connected = await bacTrackService.connectToDevice(devices[0].id);
      if (connected) {
        setDeviceConnected(true);
        Alert.alert('Connected', 'Successfully connected to BACtrack device');
      }
    } catch (error) {
      Alert.alert('Connection Error', 'Failed to connect to BACtrack device');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBreathalyzerTest = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'BAC testing is only available on mobile devices');
      return;
    }

    try {
      const reading = await bacTrackService.startBreathalyzerTest();
      
      if (reading !== null) {
        const bacReading: BACReading = {
          id: Date.now().toString(),
          userId: user?.id || '',
          value: reading,
          unit: 'mg/dL',
          timestamp: new Date().toISOString(),
          source: 'device',
          deviceId: 'bactrack_001',
          synced: false,
        };

        await dbService.saveBACReading(bacReading);
        setCurrentBACReading(bacReading);
        
        Alert.alert('Test Complete', `BAC Reading: ${ConversionService.formatBACValue(reading, 'mg/dL')}`);
      }
    } catch (error) {
      Alert.alert('Test Error', 'Failed to complete breathalyzer test');
    }
  };

  const handleManualBACEntry = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'BAC entry is only available on mobile devices');
      return;
    }

    const value = parseFloat(manualBAC);
    
    if (isNaN(value) || value < 0) {
      Alert.alert('Invalid Entry', 'Please enter a valid BAC value');
      return;
    }

    const bacReading: BACReading = {
      id: Date.now().toString(),
      userId: user?.id || '',
      value,
      unit: bacUnit,
      timestamp: new Date().toISOString(),
      source: 'manual',
      synced: false,
    };

    await dbService.saveBACReading(bacReading);
    setCurrentBACReading(bacReading);
    setShowBACEntry(false);
    setManualBAC('');
  };

  const convertBACValue = (reading: BACReading) => {
    if (reading.unit === bacUnit) {
      return reading.value;
    }
    
    if (bacUnit === 'mmol/L') {
      return ConversionService.mgDLToMmolL(reading.value);
    } else {
      return ConversionService.mmolLToMgDL(reading.value);
    }
  };

  const handleStartSymptomAssessment = () => {
    console.log('handleStartSymptomAssessment called'); // Debug log
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Symptom assessment is only available on mobile devices');
      return;
    }
    console.log('Setting symptoms modal to true'); // Debug log
    
    // Try modal first, with navigation fallback
    try {
      setShowSymptomsModal(true);
    } catch (error) {
      console.log('Modal failed, trying navigation:', error);
      // Fallback to navigation if modal doesn't work
      router.push('/(tabs)/symptoms');
    }
  };

  const handleSymptomsComplete = () => {
    setShowSymptomsModal(false);
    Alert.alert('Assessment Complete', 'Your symptom assessment has been saved successfully.');
  };

  return (
    <>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {user?.role === 'doctor' ? 'Dr.' : ''} {user?.firstName}
          </Text>
          <Text style={styles.subtitle}>
            {user?.role === 'doctor' ? 'Patient Management Dashboard' : 'Health Tracking Dashboard'}
          </Text>
        </View>

        {/* Current BAC Reading Display */}
        {currentBACReading && (
          <View style={styles.readingCard}>
            <Text style={styles.readingLabel}>Current BAC Reading</Text>
            <Text style={styles.readingValue}>
              {ConversionService.formatBACValue(convertBACValue(currentBACReading), bacUnit)}
            </Text>
            <Text style={styles.readingTime}>
              {new Date(currentBACReading.timestamp).toLocaleTimeString()}
            </Text>
          </View>
        )}

        {/* BAC Tracking Section */}
        {Platform.OS !== 'web' && (
          <QuestionCard
            question="Would you like to take a BAC reading?"
            showSkip={false}
          >
            <View style={styles.bacControls}>
              <AccessibleButton
                title={deviceConnected ? "Take Breathalyzer Test" : "Connect BACtrack Device"}
                onPress={deviceConnected ? handleBreathalyzerTest : handleBluetoothConnect}
                variant="primary"
                disabled={isConnecting}
                style={styles.bacButton}
              />
              
              <Text style={styles.orText}>or</Text>
              
              <AccessibleButton
                title="Enter BAC Manually"
                onPress={() => setShowBACEntry(true)}
                variant="secondary"
                style={styles.bacButton}
              />
            </View>
          </QuestionCard>
        )}

        {/* Manual BAC Entry */}
        {showBACEntry && Platform.OS !== 'web' && (
          <QuestionCard
            question={`Enter your BAC reading in ${bacUnit}`}
            onSkip={() => setShowBACEntry(false)}
          >
            <View style={styles.manualEntry}>
              <TextInput
                style={styles.bacInput}
                value={manualBAC}
                onChangeText={setManualBAC}
                placeholder={`0.00 ${bacUnit}`}
                keyboardType="numeric"
              />
              <AccessibleButton
                title="Save Reading"
                onPress={handleManualBACEntry}
                variant="success"
                style={styles.saveButton}
              />
            </View>
          </QuestionCard>
        )}

        {/* Quick Actions */}
        {Platform.OS !== 'web' ? (
          <View style={styles.quickActions}>
            <AccessibleButton
              title="Start Symptom Assessment"
              onPress={handleStartSymptomAssessment}
              variant="primary"
              style={styles.actionButton}
            />
            
            <AccessibleButton
              title="View My Reports"
              onPress={() => router.push('/(tabs)/reports')}
              variant="secondary"
              style={styles.actionButton}
            />
          </View>
        ) : (
          <View style={styles.webActions}>
            <Text style={styles.webActionsTitle}>Web Dashboard</Text>
            <Text style={styles.webActionsText}>
              Use this web interface to build your symptoms questionnaire and view reports.
              For symptom tracking and BAC readings, use the mobile app.
            </Text>
          </View>
        )}

        {/* Sync Status */}
        {Platform.OS !== 'web' && (
          <View style={styles.syncStatus}>
            <Text style={styles.syncText}>
              {navigator.onLine ? '🟢 Online - Data syncing automatically' : '🔴 Offline - Data will sync when connected'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Symptoms Modal */}
      <Modal
        visible={showSymptomsModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SymptomsScreen 
          onComplete={handleSymptomsComplete}
          onCancel={() => setShowSymptomsModal(false)}
        />
      </Modal>
    </>
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
  greeting: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1F2937',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  readingCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    alignItems: 'center',
  },
  readingLabel: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '600',
  },
  readingValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#2563EB',
    marginVertical: 8,
  },
  readingTime: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  bacControls: {
    gap: 16,
    alignItems: 'center',
  },
  bacButton: {
    width: '100%',
  },
  orText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  manualEntry: {
    gap: 16,
  },
  bacInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 18,
    textAlign: 'center',
    color: '#1F2937',
  },
  saveButton: {
    minHeight: 56,
  },
  quickActions: {
    paddingHorizontal: 16,
    gap: 12,
    marginVertical: 20,
  },
  actionButton: {
    minHeight: 56,
  },
  syncStatus: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    alignItems: 'center',
  },
  syncText: {
    fontSize: 14,
    color: '#6B7280',
  },
  webActions: {
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
  },
  webActionsTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  webActionsText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
  },
});