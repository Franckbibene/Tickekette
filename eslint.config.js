import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', 'client/dist/**', 'server/data/**'] },

  // Serveur (Node.js, JavaScript)
  {
    files: ['server/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
      'prefer-const': 'error',
    },
  },

  // Service worker du front
  {
    files: ['client/public/sw.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.serviceworker },
  },

  // Front (React + TypeScript) : règles avec analyse de types, hooks, accessibilité
  {
    files: ['client/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Libellés du type <label><input /><span><strong>Texte</strong></span></label>.
      'jsx-a11y/label-has-associated-control': ['error', { depth: 3 }],
    },
  },
  {
    files: ['client/**/*.test.{ts,tsx}', 'client/src/test/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
