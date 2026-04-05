import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f7fb',
    justifyContent: 'center',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  labelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  bodyText: {
    fontSize: 16,
    color: '#334155',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 52,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 14,
  },
  infoText: {
    color: '#1d4ed8',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    minHeight: 52,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#1d4ed8',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  tertiaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  tertiaryButtonText: {
    color: '#1d4ed8',
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  spacer: {
    height: 8,
  },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  settingTextBlock: {
    flex: 1,
    gap: 6,
  },
  healthCheckContainer: {
    marginVertical: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  healthCheckContainerSuccess: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },
  healthCheckContainerFailure: {
    borderColor: '#dc2626',
    backgroundColor: '#fef2f2',
  },
  healthCheckTitleText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  healthCheckTitleTextSuccess: {
    color: '#15803d',
  },
  healthCheckTitleTextFailure: {
    color: '#991b1b',
  },
  healthCheckBodyText: {
    fontSize: 12,
  },
  healthCheckBodyTextSuccess: {
    color: '#166534',
  },
  healthCheckBodyTextFailure: {
    color: '#7f1d1d',
  },
  healthCheckErrorText: {
    fontSize: 10,
    marginTop: 8,
    fontFamily: 'monospace',
  },
  healthCheckErrorTextSuccess: {
    color: '#166534',
  },
  healthCheckErrorTextFailure: {
    color: '#7f1d1d',
  },
});
