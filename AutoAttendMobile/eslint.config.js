// Flat ESLint config for the Expo / React Native app.
// Extends Expo's recommended rules and disables formatting rules that
// conflict with Prettier.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettier,
  {
    ignores: ['node_modules', 'dist', '.expo', 'android', 'ios', 'web-build'],
  },
  {
    rules: {
      // Allow intentionally-unused capitalised/underscored names.
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // Best-effort try/catch guards are common in RN UI code.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Cosmetic: apostrophes in JSX text are fine in a mobile UI.
      'react/no-unescaped-entities': 'off',
      // Render-callback factories (navigation headers/icons) legitimately
      // return anonymous components; naming them adds no value here.
      'react/display-name': 'off',
    },
  },
]);
