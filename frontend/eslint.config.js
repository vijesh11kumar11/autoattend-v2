import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist', 'build', 'node_modules', 'coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // The codebase does not use prop-types; types are validated at the API layer.
      'react/prop-types': 'off',
      // Curly apostrophes/quotes in user-facing copy are intentional, not bugs.
      'react/no-unescaped-entities': 'off',
      // Best-effort `try { } catch {}` guards in UI code are allowed; other
      // empty blocks are still flagged.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Effect-dependency completeness is advisory in this codebase.
      'react-hooks/exhaustive-deps': 'warn',
      // Allow intentionally-unused capitalised/underscored names (e.g. _unused, Components).
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  // Disable stylistic rules that conflict with Prettier.
  prettier,
];
