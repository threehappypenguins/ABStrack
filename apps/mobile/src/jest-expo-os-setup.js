/**
 * Set before any module imports expo-modules-core (e.g. expo-secure-store),
 * which reads process.env.EXPO_OS during load.
 * Default matches `jest.config.cts`; callers may set `EXPO_OS` before Jest runs (e.g. Android-like tests).
 */
process.env.EXPO_OS ??= 'ios';
