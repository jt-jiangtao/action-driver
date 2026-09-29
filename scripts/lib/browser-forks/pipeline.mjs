import { mkdir, open, readFile, writeFile, rename, rm, lstat, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { digest } from './inputs.mjs'

export const stageNames = ['prepare', 'sync', 'build', 'export', 'verify', 'package']
export function parseBuildArgs(args) {
  const [stage, ...rest] = args
  if (![...stageNames, 'all'].includes(stage)) throw new Error('ARGUMENT_INVALID: stage')
  const options = { stage, jobs: 8 }
  const seen = new Set()
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1]
    if (seen.has(flag)) throw new Error(`ARGUMENT_INVALID: duplicate ${flag}`)
    seen.add(flag)
    if (flag === '--jobs' && /^[1-9]\d*$/.test(value ?? '') && Number.isSafeInteger(Number(value))) options.jobs = Number(value)
    else if (flag === '--from' && stage === 'all' && stageNames.includes(value)) options.from = value
    else throw new Error(`ARGUMENT_INVALID: ${flag}`)
  }
  return options
}
const inputDigest = c => digest(JSON.stringify({ lock: c.lock, templates: c.inputDigest, jobs: c.jobs }))
async function outputDigest(root, outputs) {
  const rows = []
  async function visit(file) {
    const relative = path.relative(root, file)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('OUTPUT_INVALID: path escapes root')
    const stat = await lstat(file)
    if (stat.isSymbolicLink()) rows.push([relative, 'link', await readlink(file)])
    else if (stat.isDirectory()) {
      rows.push([relative, 'directory'])
      for (const entry of (await readdir(file)).sort()) await visit(path.join(file, entry))
    } else if (stat.isFile()) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      rows.push([relative, stat.mode & 0o777, hash.digest('hex')])
    }
    else throw new Error(`OUTPUT_INVALID: ${file}`)
  }
  for (const file of [...outputs].sort()) await visit(path.resolve(root, file))
  return digest(JSON.stringify(rows))
}
export async function stageResult(context, outputs) {
  return { outputs, inputDigest: inputDigest(context), outputDigest: await outputDigest(context.root, outputs) }
}
export async function runPipeline(context, options, stages) {
  const directory = path.join(context.root, 'thridparty/build/browser-forks')
  await mkdir(directory, { recursive: true })
  const lockPath = path.join(directory, 'active.lock')
  let handle
  try { handle = await open(lockPath, 'wx') } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`BUILD_ACTIVE: ${lockPath}`)
    throw error
  }
  const statePath = path.join(directory, 'state.json')
  let state = { schemaVersion: 1, stages: {} }
  const save = async () => {
    const temp = `${statePath}.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify(state, null, 2) + '\n')
    await rename(temp, statePath)
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    try { state = JSON.parse(await readFile(statePath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (state.schemaVersion !== 1 || !state.stages) throw new Error('RESUME_INVALID: state schema')
    const begin = options.stage === 'all' ? stageNames.indexOf(options.from ?? 'prepare') : stageNames.indexOf(options.stage)
    if (begin < 0) throw new Error('ARGUMENT_INVALID: stage')
    for (const name of stageNames.slice(0, begin)) {
      const previous = state.stages[name]
      try {
        if (previous?.status !== 'success' || !Array.isArray(previous.outputs) || !previous.outputs.length || previous.inputDigest !== inputDigest(context) || previous.outputDigest !== await outputDigest(context.root, previous.outputs)) throw new Error('stale inputs or outputs')
      } catch (error) { throw new Error(`RESUME_INVALID: ${name}: ${error.message}`) }
    }
    const selected = options.stage === 'all' ? stageNames.slice(begin) : [options.stage]
    for (const name of selected) {
      // Downstream success markers cannot survive a repeated prerequisite.
      for (const later of stageNames.slice(stageNames.indexOf(name))) delete state.stages[later]
      state.stages[name] = { status: 'running', startedAt: new Date().toISOString() }
      await save()
      try {
        if (!stages[name]) throw new Error(`STAGE_UNAVAILABLE: ${name}`)
        const result = await stages[name](context)
        const actual = await stageResult(context, result.outputs)
        if (actual.inputDigest !== result.inputDigest || actual.outputDigest !== result.outputDigest) throw new Error(`OUTPUT_INVALID: ${name}`)
        state.stages[name] = { ...actual, status: 'success', finishedAt: new Date().toISOString() }
        await save()
      } catch (error) {
        state.stages[name] = { status: 'failed', error: error.message, finishedAt: new Date().toISOString() }
        await save()
        throw error
      }
    }
  } finally {
    await handle.close()
    await rm(lockPath)
  }
}
