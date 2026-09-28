#!/usr/bin/env node
import { launch } from '../dist/index.js'

try {
  await launch()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
