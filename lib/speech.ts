import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

export class SpeechService {
  static async speak(text: string, options?: Speech.SpeechOptions) {
    if (Platform.OS === 'web') {
      // Web Speech API fallback
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.8;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
      }
    } else {
      await Speech.speak(text, {
        rate: 0.8,
        pitch: 1,
        ...options,
      });
    }
  }

  static stop() {
    if (Platform.OS === 'web') {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      Speech.stop();
    }
  }
}