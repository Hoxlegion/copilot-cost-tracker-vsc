import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores (replaces ignorePatterns)
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  
  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  
  // Your custom overrides & rules
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);