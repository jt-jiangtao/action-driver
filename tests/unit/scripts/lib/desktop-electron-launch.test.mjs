import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const api = await import('../../../../scripts/lib/desktop-electron-launch.mjs').catch(() => ({}))
test('overrides stale executable and preserves args cwd and exit code', async (t) => {
  assert.equal(typeof api.launchElectronVite, 'function')
  const root = await mkdtemp(path.join(tmpdir(), 'launch test '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'cli.mjs'),
    report = path.join(root, 'report.json')
  await writeFile(
    file,
    `import fs from 'node:fs';fs.writeFileSync(process.env.REPORT,JSON.stringify({exe:process.env.ELECTRON_EXEC_PATH,args:process.argv.slice(2),cwd:process.cwd(),runAsNode:process.env.ELECTRON_RUN_AS_NODE}));process.exit(7)`
  )
  assert.equal(
    await api.launchElectronVite('/own/Electron', ['preview', '--mode', 'custom'], {
      cwd: root,
      cliPath: file,
      env: {
        ...process.env,
        REPORT: report,
        ELECTRON_EXEC_PATH: '/official',
        ELECTRON_RUN_AS_NODE: '1'
      }
    }),
    7
  )
  const { readFile, realpath } = await import('node:fs/promises')
  assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), {
    exe: '/own/Electron',
    args: ['preview', '--mode', 'custom'],
    cwd: await realpath(root)
  })
})

test('does not launch after artifact validation fails', async (t) => {
  assert.equal(typeof api.runDesktopElectron, 'function')
  const root = await mkdtemp(path.join(tmpdir(), 'missing fork '))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(
    api.runDesktopElectron(['dev'], {
      projectRoot: root,
      cliPath: path.join(root, 'must-not-launch.mjs')
    }),
    /ARTIFACT_MISSING/
  )
})

test('forwards termination and preserves handled child exit', { timeout: 15000 }, async (t) => {
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const root = await mkdtemp(path.join(tmpdir(), 'signal fork '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'cli.mjs')
  await writeFile(
    file,
    `process.on('SIGTERM',()=>process.exit(23));console.log('READY');setInterval(()=>{},1000)`
  )
  const moduleUrl = new URL('../../../../scripts/lib/desktop-electron-launch.mjs', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {launchElectronVite}=await import(${JSON.stringify(moduleUrl)});process.exitCode=await launchElectronVite('/own/Electron',[],{cliPath:${JSON.stringify(file)}})`
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  })
  let output = ''
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => {
      output += data
      if (output.includes('READY')) resolve()
    })
    child.once('exit', () => reject(new Error('exited before READY')))
  })
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  assert.equal((await exit)[0], 23)
})

test('termination also closes a persistent grandchild', { timeout: 15000 }, async (t) => {
  const { spawn } = await import('node:child_process')
  const { once } = await import('node:events')
  const { readFile } = await import('node:fs/promises')
  const root = await mkdtemp(path.join(tmpdir(), 'grandchild fork '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const grand = path.join(root, 'grand.mjs'),
    cli = path.join(root, 'cli.mjs'),
    pidFile = path.join(root, 'pid')
  await writeFile(
    grand,
    `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));console.log('GRAND_READY');setInterval(()=>{},1000)`
  )
  await writeFile(
    cli,
    `import {spawn} from 'node:child_process';spawn(process.execPath,[${JSON.stringify(grand)}],{stdio:'inherit'});setInterval(()=>{},1000)`
  )
  const moduleUrl = new URL('../../../../scripts/lib/desktop-electron-launch.mjs', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {launchElectronVite}=await import(${JSON.stringify(moduleUrl)});process.exitCode=await launchElectronVite('/own/Electron',[],{cliPath:${JSON.stringify(cli)}})`
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let grandPid
  t.after(() => {
    try {
      if (grandPid) process.kill(grandPid, 'SIGKILL')
    } catch {
      /* The grandchild may already have exited. */
    }
    if (child.exitCode === null) child.kill('SIGKILL')
  })
  let output = ''
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (data) => {
      output += data
      if (output.includes('GRAND_READY')) resolve()
    })
    child.once('exit', () => reject(new Error('early exit')))
  })
  grandPid = Number(await readFile(pidFile, 'utf8'))
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  await exit
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.throws(() => process.kill(grandPid, 0), { code: 'ESRCH' })
})

test('preserves a child terminated by SIGKILL as exit 137', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'exit fork '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'cli.mjs')
  await writeFile(file, "process.kill(process.pid,'SIGKILL')")
  assert.equal(await api.launchElectronVite('/own/Electron', [], { cliPath: file }), 137)
})
