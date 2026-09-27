import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { sha256, resolveElectronFork } from '../../../scripts/lib/electron-fork.mjs'
import { getElectronForkExecutable } from './support/electron-fork'

const root = fileURLToPath(new URL('../../../', import.meta.url))
test('self-built desktop authenticates Renderer and SQLite works in utility process', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'actiondriver-fork-product-'))
  const executablePath = await getElectronForkExecutable()
  expect(executablePath).toBe((await resolveElectronFork()).executablePath)
  const runtimeRequire = createRequire(join(root, 'apps/agent-runtime/package.json'))
  const nodeBinding = join(
    dirname(runtimeRequire.resolve('better-sqlite3/package.json')),
    'build/Release/better_sqlite3.node'
  )
  const nodeBindingHash = await sha256(nodeBinding)
  const probe = join(directory, 'sqlite-probe.cjs')
  writeFileSync(
    probe,
    `const {createRequire}=require('node:module');const r=createRequire(${JSON.stringify(join(root, 'apps/agent-runtime/package.json'))});const DB=r('better-sqlite3');try{const options={nativeBinding:${JSON.stringify(join(root, 'apps/agent-runtime/native/electron/arm64/better_sqlite3.node'))}};const file=${JSON.stringify(join(directory, 'probe.sqlite'))};let db=new DB(file,options);db.exec('CREATE TABLE probe(value TEXT)');db.prepare('INSERT INTO probe VALUES(?)').run('persisted');db.close();db=new DB(file,options);const value=db.prepare('SELECT value FROM probe').get().value;db.close();process.parentPort.postMessage({value,abi:process.versions.modules,electron:process.versions.electron});}catch(error){process.parentPort.postMessage({error:error.message});}`
  )
  const application = await electron.launch({
    executablePath,
    args: ['.', `--user-data-dir=${join(directory, 'data')}`],
    cwd: join(root, 'apps/desktop'),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
      HOME: directory,
      ACTIONDRIVER_E2E_HOME_DIRECTORY: directory
    }
  })
  try {
    expect(
      await application.evaluate(() => ({
        path: process.execPath,
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        arch: process.arch
      }))
    ).toEqual({
      path: executablePath,
      electron: '38.8.6',
      chromium: '140.0.7339.249',
      arch: 'arm64'
    })
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    const status = await page.evaluate(async () => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const url = new URL(connection.wsUrl)
      url.protocol = 'http:'
      url.pathname = '/model-connections'
      return (await fetch(url, { headers: { Authorization: `Bearer ${connection.accessToken}` } }))
        .status
    })
    expect(status).toBe(200)
    const sqlite = await application.evaluate(
      ({ utilityProcess }, entry) =>
        new Promise((resolve, reject) => {
          const child = utilityProcess.fork(entry)
          const timer = setTimeout(() => {
            child.kill()
            reject(new Error('SQLITE_PROBE_TIMEOUT'))
          }, 15000)
          child.once('message', (message) => {
            clearTimeout(timer)
            child.kill()
            resolve(message)
          })
          child.once('exit', (code) => {
            clearTimeout(timer)
            reject(new Error(`SQLITE_PROBE_EXIT: ${code}`))
          })
        }),
      probe
    )
    expect(sqlite).toMatchObject({ value: 'persisted', electron: '38.8.6' })
    expect(await sha256(nodeBinding)).toBe(nodeBindingHash)
  } finally {
    await application.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
