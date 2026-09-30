import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@action-driver/runtime-contracts',
          '@action-driver/plugin-contracts',
          '@action-driver/plugin-sdk',
          '@action-driver/model-connections',
          '@action-driver/observability'
        ]
      })
    ]
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['@action-driver/model-connections'] })
    ],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), pluginPanel: resolve('src/preload/plugin-panel.ts') },
        // Sandboxed preload scripts must be CommonJS; the package is ESM, so emit .cjs explicitly.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [react()]
  }
})
