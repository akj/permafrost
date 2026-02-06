import js from '@eslint/js';
import globals from 'globals';
import stylistic from '@stylistic/eslint-plugin';

export default [
  // Global ignores
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      'metadata/',
      'src/templates/**',
    ],
  },

  // Base recommended rules
  js.configs.recommended,

  // Project config
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      // Bug prevention
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'eqeqeq': ['error', 'always'],
      'no-throw-literal': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // Deliberately off
      'no-console': 'off',
      'consistent-return': 'off',

      // Stylistic
      '@stylistic/indent': ['error', 2],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always',
      }],
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/comma-spacing': 'error',
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/space-before-blocks': 'error',
    },
  },
];
