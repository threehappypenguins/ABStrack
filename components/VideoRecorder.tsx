// components/VideoRecorder.tsx
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { AccessibleButton } from './AccessibleButton';

interface VideoRecorderProps {
  prompt: string;
  onVideoRecorded: (videoUri: string) => void;
  onComplete: (videoUri?: string) => void;
  onSkip?: () => void;
}

export function VideoRecorder({ 
  prompt, 
  onVideoRecorded, 
  onComplete, 
  onSkip 
}: VideoRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);

  const startRecording = async () => {
    try {
      setIsRecording(true);
      
      // TODO: Implement actual video recording using expo-camera or similar
      // For now, we'll simulate a recording
      setTimeout(() => {
        const mockVideoUri = `video_${Date.now()}.mp4`;
        setVideoUri(mockVideoUri);
        setIsRecording(false);
        setHasRecorded(true);
        onVideoRecorded(mockVideoUri);
      }, 3000);
      
    } catch (error) {
      console.error('Error starting video recording:', error);
      Alert.alert('Recording Error', 'Failed to start video recording');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    // In a real implementation, this would stop the camera
  };

  const handleComplete = () => {
    onComplete(videoUri || undefined);
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    } else {
      onComplete();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Video Assessment</Text>
        <Text style={styles.prompt}>{prompt}</Text>
      </View>

      <View style={styles.cameraArea}>
        {isRecording ? (
          <View style={styles.recordingIndicator}>
            <Text style={styles.recordingText}>🔴 Recording...</Text>
            <Text style={styles.recordingSubtext}>
              Follow the prompt above while recording
            </Text>
          </View>
        ) : hasRecorded ? (
          <View style={styles.completedIndicator}>
            <Text style={styles.completedText}>✅ Recording Complete</Text>
            <Text style={styles.completedSubtext}>
              Video has been recorded successfully
            </Text>
          </View>
        ) : (
          <View style={styles.readyIndicator}>
            <Text style={styles.readyText}>📹 Ready to Record</Text>
            <Text style={styles.readySubtext}>
              Position yourself in the camera view and tap Start Recording
            </Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {!hasRecorded && !isRecording && (
          <AccessibleButton
            title="Start Recording"
            onPress={startRecording}
            variant="primary"
            style={styles.recordButton}
          />
        )}

        {isRecording && (
          <AccessibleButton
            title="Stop Recording"
            onPress={stopRecording}
            variant="danger"
            style={styles.stopButton}
          />
        )}

        {hasRecorded && (
          <AccessibleButton
            title="Continue"
            onPress={handleComplete}
            variant="success"
            style={styles.continueButton}
          />
        )}

        <AccessibleButton
          title={hasRecorded ? "Skip Video" : "Skip This Step"}
          onPress={handleSkip}
          variant="secondary"
          style={styles.skipButton}
        />
      </View>

      <View style={styles.instructions}>
        <Text style={styles.instructionText}>
          This video assessment helps track visual symptoms over time. 
          The recording is stored securely and only shared with your healthcare provider if configured.
        </Text>
      </View>
    </View>
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
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 12,
  },
  prompt: {
    fontSize: 18,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 24,
    fontStyle: 'italic',
    backgroundColor: '#EEF2FF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  cameraArea: {
    flex: 1,
    margin: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  recordingIndicator: {
    alignItems: 'center',
    padding: 32,
  },
  recordingText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#DC2626',
    marginBottom: 8,
  },
  recordingSubtext: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  completedIndicator: {
    alignItems: 'center',
    padding: 32,
  },
  completedText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#059669',
    marginBottom: 8,
  },
  completedSubtext: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  readyIndicator: {
    alignItems: 'center',
    padding: 32,
  },
  readyText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#2563EB',
    marginBottom: 8,
  },
  readySubtext: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  controls: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 12,
  },
  recordButton: {
    minHeight: 56,
    backgroundColor: '#DC2626',
  },
  stopButton: {
    minHeight: 56,
  },
  continueButton: {
    minHeight: 56,
  },
  skipButton: {
    minHeight: 48,
  },
  instructions: {
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  instructionText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});