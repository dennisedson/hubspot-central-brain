import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The UI extension directories carry their own flat config and their own
    // toolchain, run via `npm run typecheck:cards` / `hs project lint`. The root
    // config cannot parse them — they are outside its tsconfig project — so it
    // must not try.
    ignores: [
      'dist/',
      'node_modules/',
      '**/__tests__/',
      'src/app/cards/**',
      'src/app/pages/**',
      'src/app/settings/**',
    ],
  }
);
