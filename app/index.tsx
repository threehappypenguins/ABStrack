// app/index.tsx
import '../global.css';
import { useAuth } from '@/context/AuthContext';
import { Href, router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function IndexScreen() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace('/(tabs)' as Href);
      } else {
        router.replace('/(auth)/' as Href);
      }
    }
  }, [user, loading]);

  return (
    <View className="flex-1 justify-center items-center bg-gray-50">
      <ActivityIndicator size="large" color="#2563EB" />
    </View>
  );
}