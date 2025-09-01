import { AccessibleButton } from '@/components/AccessibleButton';
import { useAuth } from '@/context/AuthContext';
import React, { useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';

const screenWidth = Dimensions.get('window').width;

export default function ReportsScreen() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [reportData, setReportData] = useState({
    bacReadings: [],
    symptoms: [],
    carbEntries: [],
  });

  // Mock data for demonstration
  const mockBACData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        data: [0.02, 0.01, 0.03, 0.00, 0.01, 0.04, 0.02],
        color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
        strokeWidth: 3,
      },
    ],
  };

  const chartConfig = {
    backgroundColor: '#FFFFFF',
    backgroundGradientFrom: '#FFFFFF',
    backgroundGradientTo: '#FFFFFF',
    decimalPlaces: 3,
    color: (opacity = 1) => `rgba(37, 99, 235, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
    style: {
      borderRadius: 16,
    },
    propsForDots: {
      r: '6',
      strokeWidth: '2',
      stroke: '#2563EB',
    },
  };

  const timeRangeOptions = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
  ] as const;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {user?.role === 'doctor' ? 'Patient Reports' : 'My Health Reports'}
        </Text>
        <Text style={styles.subtitle}>
          {user?.role === 'doctor' 
            ? 'View comprehensive patient data and trends'
            : 'Track your symptoms and recovery progress'
          }
        </Text>
      </View>

      {/* Time Range Selector */}
      <View style={styles.timeRangeContainer}>
        {timeRangeOptions.map((option) => (
          <AccessibleButton
            key={option.value}
            title={option.label}
            onPress={() => setTimeRange(option.value)}
            variant={timeRange === option.value ? 'primary' : 'secondary'}
            style={styles.timeRangeButton}
          />
        ))}
      </View>

      {/* BAC Trends Chart */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>BAC Readings Over Time</Text>
        <LineChart
          data={mockBACData}
          width={screenWidth - 64}
          height={220}
          chartConfig={chartConfig}
          bezier
          style={styles.chart}
        />
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>14</Text>
          <Text style={styles.summaryLabel}>Total Entries</Text>
        </View>
        
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>0.015</Text>
          <Text style={styles.summaryLabel}>Avg BAC (mg/dL)</Text>
        </View>
        
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>3</Text>
          <Text style={styles.summaryLabel}>Active Symptoms</Text>
        </View>
        
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>92%</Text>
          <Text style={styles.summaryLabel}>Data Synced</Text>
        </View>
      </View>

      {/* Recent Symptoms */}
      <View style={styles.recentSection}>
        <Text style={styles.sectionTitle}>Recent Symptoms</Text>
        
        <View style={styles.symptomCard}>
          <View style={styles.symptomHeader}>
            <Text style={styles.symptomName}>Headache</Text>
            <Text style={styles.symptomSeverity}>Moderate</Text>
          </View>
          <Text style={styles.symptomTime}>2 hours ago</Text>
        </View>

        <View style={styles.symptomCard}>
          <View style={styles.symptomHeader}>
            <Text style={styles.symptomName}>Dizziness</Text>
            <Text style={styles.symptomSeverity}>Slight</Text>
          </View>
          <Text style={styles.symptomTime}>6 hours ago</Text>
        </View>
      </View>

      {user?.role === 'doctor' && (
        <View style={styles.doctorActions}>
          <AccessibleButton
            title="Export Patient Data"
            onPress={() => {/* Export functionality */}}
            variant="primary"
            style={styles.actionButton}
          />
          <AccessibleButton
            title="Generate Report"
            onPress={() => {/* Generate report */}}
            variant="secondary"
            style={styles.actionButton}
          />
        </View>
      )}
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
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 20,
  },
  timeRangeButton: {
    flex: 1,
    minHeight: 44,
  },
  chartCard: {
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
  chartTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 12,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2563EB',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
  },
  recentSection: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 16,
  },
  symptomCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
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
    alignItems: 'center',
  },
  symptomName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  symptomSeverity: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F59E0B',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  symptomTime: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  doctorActions: {
    paddingHorizontal: 16,
    gap: 12,
    marginTop: 24,
    marginBottom: 40,
  },
  actionButton: {
    minHeight: 56,
  },
});