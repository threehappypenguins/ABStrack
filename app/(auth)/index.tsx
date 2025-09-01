// app/(auth)/index.tsx
import { AccessibleButton } from '@/components/AccessibleButton';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function WelcomeScreen() {
  const handleSignIn = () => {
    router.push('/(auth)/login');
  };

  const handleCreateAccount = () => {
    router.push('/(auth)/register');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialIcons name="monitor-heart" size={64} color="#2563EB" />
        <Text style={styles.title}>ABStrack</Text>
        <Text style={styles.subtitle}>
          Track symptoms and monitor your health with professional-grade tools
        </Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.description}>
          Designed for patients and healthcare providers to monitor symptoms, 
          track vital signs, and maintain comprehensive health records.
        </Text>
      </View>

      <View style={styles.actions}>
        <AccessibleButton
          title="Sign In"
          onPress={handleSignIn}
          variant="primary"
          style={styles.button}
        />
        
        <AccessibleButton
          title="Create Account"
          onPress={handleCreateAccount}
          variant="secondary"
          style={styles.button}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginTop: 80,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1F2937',
    marginTop: 16,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  description: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 24,
  },
  actions: {
    gap: 16,
    marginBottom: 40,
  },
  button: {
    minHeight: 56,
  },
});