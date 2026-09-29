#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { loadBuildInputs } from './lib/browser-forks/inputs.mjs'
import { runCommand } from './lib/browser-forks/runner.mjs'
import { parseBuildArgs, runPipeline, stageNames } from './lib/browser-forks/pipeline.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
if (process.argv.slice(2).includes('--help')) {
  console.log('Usage: node scripts/build-browser-forks.mjs <prepare|sync|build|export|verify|package|all> [--jobs 8] [--from stage]\n--from is only valid with all. Prerequisite state and outputs are revalidated. Logs: thirdparty/logs/browser-forks/.')
} else {
  try {
    const options = parseBuildArgs(process.argv.slice(2))
    const inputs = await loadBuildInputs(root)
    const modules = { prepare: ['prepare', 'runPrepare'], sync: ['sync', 'runSync'], build: ['build', 'runBuild'], export: ['provenance', 'runExport'], verify: ['provenance', 'verifyBuildOutputs'], package: ['package', 'runPackage'] }
    const stages = Object.fromEntries(stageNames.map(name => [name, async context => {
      const current = await loadBuildInputs(root)
      if (current.digest !== context.inputDigest) throw new Error('INPUT_CHANGED: restart with current locked inputs')
      console.log(`Starting ${name}; logs: ${root}/thirdparty/logs/browser-forks/`)
      const [file, exported] = modules[name]
      const module = await import(`./lib/browser-forks/${file}.mjs`)
      const result = await module[exported](context)
      console.log(`Completed ${name}`)
      return result
    }]))
    await runPipeline({ root, jobs: options.jobs, lock: inputs.lock, inputDigest: inputs.digest, run: runCommand }, options, stages)
  } catch (error) {
    console.error(error.message)
    process.exitCode = error.exitCode ?? 1
  }
}
