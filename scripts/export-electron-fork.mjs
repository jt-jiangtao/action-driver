#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { exportElectronFork } from './lib/export-electron-fork.mjs'
try {
  const { record, backup } = await exportElectronFork(
    fileURLToPath(new URL('../', import.meta.url))
  )
  console.log(
    `Exported Electron ${record.version}; source ${record.sourceCommit}; old matched pair: ${backup}`
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
