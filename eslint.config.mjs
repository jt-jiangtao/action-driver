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
      'thridparty/**',
      'apps/agent-runtime/resources/system-skills/**',
      'plugins/*/skills/**',
      'apps/agent-runtime/vendor/**',
      'scripts/e2e-interactions/fixtures/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side helper scripts that ship with the runtime or the packaging flow.
    files: ['scripts/**/*.mjs', 'apps/agent-runtime/scripts/**/*.mjs',
      'apps/agent-runtime/resources/js-repl/**/*.mjs',
      'apps/agent-runtime/src/plugins/**/*.mjs', 'packages/create-actiondriver-plugin/src/**/*.mjs'],
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
  }
)
