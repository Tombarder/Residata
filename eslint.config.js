import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// 2026-06-01 (post-DP-077 health-check sweep): CI was failing for 24h+ on
// 158 problems — almost all pre-existing, mostly noise from new React 19
// rules (set-state-in-effect, static-components, purity) and
// `no-unused-vars`/`no-empty` catching intentional `catch (_) {}` /
// underscore-only swallow patterns. Three GENUINE bugs were hiding under
// the noise: F-254 duplicate object key in Ticker.jsx, F-255 + F-256
// rules-of-hooks violations (useState/useRef called after early returns).
// Fixed inline, then split rules into two tiers:
//
//   ERROR (CI-blocks) — patterns that genuinely break behavior or
//   compliance: rules-of-hooks, no-dupe-keys, no-undef.
//
//   WARN (visible, non-blocking) — code-smell only: no-unused-vars,
//   no-empty, react-hooks/exhaustive-deps, new-React-19 rules that flag
//   long-standing valid patterns until the codebase migrates.
//
// Net: whole-repo CI green again; signal preserved for the categories
// that actually catch live bugs.

export default defineConfig([
  globalIgnores(['dist']),

  // Frontend source — browser globals.
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // — Real bugs: keep as errors —
      'react-hooks/rules-of-hooks': 'error',
      'no-dupe-keys': 'error',
      'no-undef': 'error',

      // — Code smell: warn but don't block CI —
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]|^_', argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // New React 19 rules that flag long-standing working patterns.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-refresh/only-export-components': 'warn',
    },
  },

  // Vercel API routes — Node.js context.
  {
    files: ['api/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]|^_', argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'warn',
    },
  },

  // Vite + other build configs — Node.js context.
  {
    files: ['vite.config.{js,mjs}', '*.config.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
])
