import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@action-driver/plugin-contracts': `${root}packages/plugin-contracts/src/index.ts`,
      '@action-driver/plugin-sdk': `${root}packages/plugin-sdk/src/index.ts`,
      '@action-driver/contracts': `${root}packages/contracts/src/index.ts`,
      '@desktop': `${root}apps/desktop/src/renderer`
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/e2e/**', 'thirdparty/**'],
    css: true
  }
})
