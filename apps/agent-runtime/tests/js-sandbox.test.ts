import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionSandbox, type SandboxPrepared } from '../src/execution/session-sandbox'
import { sessionWorkspacePaths } from '../src/execution/session-workspace'

const launches: SandboxPrepared[] = []
const directories: string[] = []
const executable = realpathSync(process.execPath)
afterEach(async () => {
  for (const launch of launches.splice(0)) await launch.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function prepare() {
  const root = await mkdtemp(join(tmpdir(), 'actiondriver-js-sandbox-'))
  directories.push(root)
  const workspace = sessionWorkspacePaths(root, 'session')
  const launch = await new SessionSandbox({ runtimeRoots: [dirname(executable)] }).prepare({
    workspace, jsExecutable: executable,
    environment: { ACTIONDRIVER_SERVICE_TOKEN: 'must-not-leak', NODE_OPTIONS: '--inspect' }
  })
  launches.push(launch)
  return { launch, workspace }
}
async function run(code: string) {
  const { launch, workspace } = await prepare()
  const command = launch.wrap(executable, ['-e', code])
  return await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { env: launch.environment, cwd: workspace.root })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
  })
}

describe.skipIf(process.platform !== 'darwin')('untrusted JS process sandbox', () => {
  it('runs Node without exposing inherited credentials or NODE_OPTIONS', async () => {
    const result = await run('console.log(JSON.stringify(process.env))')
    expect(result.code).toBe(0)
    expect(result.output).not.toContain('must-not-leak')
    expect(result.output).not.toContain('NODE_OPTIONS')
  })
  it('denies osascript even when model code accesses the real process runtime', async () => {
    const result = await run(`const r = require('node:child_process').spawnSync('/usr/bin/osascript', ['-e', 'return 42']); console.log(JSON.stringify({status:r.status,error:r.error?.code,output:r.stdout?.toString()}))`)
    expect(result.code).toBe(0)
    expect(result.output).toContain('"error":"EPERM"')
    expect(result.output).not.toContain('"output":"42')
  })
  it('denies launching another Node process', async () => {
    const result = await run(`const r = require('node:child_process').spawnSync(process.execPath, ['-e', 'console.log("CHILD_RAN")']); console.log(JSON.stringify({status:r.status,error:r.error?.code,output:r.stdout?.toString()}))`)
    expect(result.code).toBe(0)
    expect(result.output).toContain('"error":"EPERM"')
    expect(result.output).not.toContain('CHILD_RAN')
  })
})
