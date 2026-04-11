import nx from '@nx/eslint-plugin';
import reactNativeA11y from 'eslint-plugin-react-native-a11y';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      'react-native-a11y': reactNativeA11y,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactNativeA11y.configs.all.rules,
      // Labels are sufficient for current controls; hints are optional extras when the
      // label alone does not convey purpose (Apple HIG). Re-enable when you add flows
      // that need supplementary VoiceOver text.
      'react-native-a11y/has-accessibility-hint': 'off',
    },
  },
  {
    ignores: ['.expo', 'web-build', 'cache', 'dist', '**/out-tsc'],
  },
];
