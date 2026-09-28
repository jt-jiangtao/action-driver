import { constants } from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resolveElectronFork } from './electron-fork.mjs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
export function launchElectronVite(executablePath, args, options = {}) {
  const cliPath =
    options.cliPath ??
    path.join(path.dirname(require.resolve('electron-vite/package.json')), 'dist/cli.mjs')
  const env = { ...(options.env ?? process.env), ELECTRON_EXEC_PATH: executablePath }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd ?? path.join(root, 'apps/desktop'),
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32'
    })
    const signalGroup = (signal) => {
      try {
        if (process.platform === 'win32') child.kill(signal)
        else if (child.pid) process.kill(-child.pid, signal)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    const interrupt = () => signalGroup('SIGINT'),
      terminate = () => signalGroup('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const cleanup = () => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
    child.once('error', (error) => {
      cleanup()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      cleanup()
      resolve(code ?? 128 + (constants.signals[signal] ?? 15))
    })
  })
}
export async function runDesktopElectron(args, options = {}) {
  const artifact = await resolveElectronFork({ projectRoot: options.projectRoot })
  return launchElectronVite(artifact.executablePath, args, options)
}
