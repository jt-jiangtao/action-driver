import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@actiondriver/contracts': `${root}packages/contracts/src/index.ts`,
      '@actiondriver/design-tokens': `${root}packages/design-tokens/src/index.ts`,
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
