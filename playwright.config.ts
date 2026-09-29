import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './apps/desktop/tests/e2e',
  snapshotPathTemplate: '{testDir}/../../../../design/references/{arg}{ext}',
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure'
  },
  reporter: [['list']]
})
