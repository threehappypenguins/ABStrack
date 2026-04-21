/**
 * Set before any module imports expo-modules-core (e.g. expo-secure-store),
 * which reads process.env.EXPO_OS during load.
 */
process.env.EXPO_OS = 'ios';
