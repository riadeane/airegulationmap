import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // .claude/ holds agent worktrees (full checkouts) and local session state.
  { ignores: ['dist/', 'node_modules/', 'public/', 'docs/', 'PLANS/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{js,ts}', 'tests/**/*.{js,ts}', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // The codebase deliberately uses `catch (e) { /* reason */ }` for
      // storage/clipboard feature detection - don't flag the unused param.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
    },
  },
  {
    // Build-time Node scripts (the static page generator).
    files: ['scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
);
