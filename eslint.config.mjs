import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.defineConfig(
  // Global ignores (replaces ignorePatterns)
  {
    ignores: ['dist/**', 'node_modules/**', 'src/webview/**', '*.mjs', '*.js'],
  },

  // Type-aware linting for src and test TypeScript files only
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
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
);