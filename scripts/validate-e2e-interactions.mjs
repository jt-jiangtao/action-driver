#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadInteractionContracts } from './e2e-interactions/contracts.mjs'
import { validateInteractionSources } from './e2e-interactions/validator.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function rendererSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return rendererSources(path)
    return entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')
      ? [path]
      : []
  })
}

function options(argv) {
  const files = []
  let contractsFile = resolve(projectRoot, 'apps/desktop/tests/e2e/interaction-contracts.json')
  let skipContracts = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--files') {
      const file = argv[index + 1]
      if (!file) throw new Error('--files requires a path')
      files.push(resolve(file))
      index += 1
    } else if (argument === '--contracts') {
      const file = argv[index + 1]
      if (!file) throw new Error('--contracts requires a path')
      contractsFile = resolve(file)
      index += 1
    } else if (argument === '--skip-contracts') {
      skipContracts = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  return {
    files: files.length
      ? files
      : rendererSources(resolve(projectRoot, 'apps/desktop/src/renderer/src')),
    contracts: skipContracts ? undefined : loadInteractionContracts(contractsFile)
  }
}

try {
  const result = validateInteractionSources({ ...options(process.argv.slice(2)), projectRoot })
  for (const issue of result.errors) {
    console.error(`${issue.file}:${issue.line}:${issue.column} [${issue.code}] ${issue.message}`)
  }
  if (result.errors.length) process.exitCode = 1
  else console.log(`Validated ${result.interactions.length} interaction declarations.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
