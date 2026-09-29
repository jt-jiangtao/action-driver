import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@actiondriver/plugin-contracts': `${root}packages/plugin-contracts/src/index.ts`,
      '@actiondriver/plugin-sdk': `${root}packages/plugin-sdk/src/index.ts`,
      '@actiondriver/contracts': `${root}packages/contracts/src/index.ts`,
      '@desktop': `${root}apps/desktop/src/renderer`
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/e2e/**', 'apps/agent-runtime/vendor/**', 'thridparty/**'],
    css: true
  }
})
