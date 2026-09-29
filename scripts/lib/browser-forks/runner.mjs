import { spawn } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import path from 'node:path'

/** Run one argv command; logs never include environment values. */
export async function runCommand({ file, args, cwd, env = process.env, logPath }) {
  await mkdir(path.dirname(logPath), { recursive: true })
  const log = await open(logPath, 'a')
  const childEnv = { ...env }
  delete childEnv.ELECTRON_RUN_AS_NODE
  try {
    await log.write(`${JSON.stringify({ file, args, cwd })}\n`)
    await new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        cwd, env: childEnv, detached: process.platform !== 'win32',
        stdio: ['ignore', log.fd, log.fd]
      })
      const forward = signal => {
        if (!child.pid) return
        try {
          if (process.platform === 'win32') child.kill(signal)
          else process.kill(-child.pid, signal)
        } catch (error) { if (error.code !== 'ESRCH') reject(error) }
      }
      const interrupt = () => forward('SIGINT')
      const terminate = () => forward('SIGTERM')
      process.on('SIGINT', interrupt)
      process.on('SIGTERM', terminate)
      child.once('error', reject)
      child.once('close', (code, signal) => {
        process.off('SIGINT', interrupt)
        process.off('SIGTERM', terminate)
        if (code === 0) resolve()
        else {
          const error = new Error(`COMMAND_FAILED: ${file} exited ${code ?? signal}; log: ${logPath}`)
          error.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143)
          reject(error)
        }
      })
    })
  } finally { await log.close() }
}
