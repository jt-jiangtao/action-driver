import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/{cua-parity,cua,sky,cua-repl,browser-runtime}/tests/**/*.test.ts']
  }
})
