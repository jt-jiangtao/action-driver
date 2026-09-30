import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.superpowers/**',
      'thirdparty/**',
      // Immutable original-package snapshots and generated analysis evidence.
      'thirdparty/backup/**',
      'analysis/codex-cua/**',
      'apps/local-runtime/resources/system-skills/**',
      'plugins/*/skills/**',
      'scripts/e2e-interactions/fixtures/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side helper scripts that ship with the runtime or the packaging flow.
    files: ['scripts/**/*.mjs', 'tests/unit/scripts/**/*.mjs', 'apps/local-runtime/scripts/**/*.mjs',
      'apps/local-runtime/resources/js-repl/**/*.mjs',
      'apps/local-runtime/src/plugins/**/*.mjs', 'packages/create-action-driver-plugin/src/**/*.mjs',
      'packages/{cua,sky,cua-repl,browser-runtime,cua-parity}/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        queueMicrotask: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true
      }]
    }
  },
  {
    // The reconstructed candidates retain original declaration shapes and explicit empty guards.
    // Keep this exception local until the owned-host migration and final cleanup are complete.
    files: ['packages/{cua,sky,cua-repl,browser-runtime,cua-parity}/**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'prefer-const': 'off',
      'no-empty': 'off'
    }
  }
)
