// Root ESLint flat config (Phase 2 Step 11). `npm run lint` must report no errors; warnings are
// tracked debt, not blockers.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      'server/prisma/migrations/**',
      'mobile/android/**',
      'mobile/ios/**',
      'design_reference/**',
      'components_reference/**',
      '**/*.config.{js,cjs,mjs}',
      'mobile/babel.config.js',
      'mobile/metro.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}', 'mobile/src/**/*.{ts,tsx}', 'mobile/App.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  }
);
