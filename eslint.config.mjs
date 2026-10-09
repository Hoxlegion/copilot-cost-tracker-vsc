import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  // Global ignores (replaces ignorePatterns)
  {
    ignores: ['dist/**', 'node_modules/**', 'src/webview/**', '**/*.mjs', '**/*.js'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware linting for src and test TypeScript files only
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // VS Code ^1.85 runs extensions on Node 18, which has no built-in SQLite.
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'node:sqlite', message: 'Not available in VS Code ^1.85 (Node 18); read traces through the sql.js snapshot.' },
          { name: 'sqlite', message: 'Not available in VS Code ^1.85 (Node 18); read traces through the sql.js snapshot.' },
        ],
      }],
    },
  },
];