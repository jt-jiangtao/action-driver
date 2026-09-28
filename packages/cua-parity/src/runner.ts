import { fork } from 'node:child_process'
import { assertJson } from './json.js'
import type { CaseSpec, Outcome } from './types.js'
export async function runCase(targetEntry: string, spec: CaseSpec): Promise<Outcome> {
  const base: Outcome = {
    status: 'protocol-error',
    value: null,
    error: null,
    trace: [],
    stdout: '',
    stderr: ''
  }
  try {
    assertJson(spec.input)
    if (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs <= 0) throw new Error('Invalid timeout')
  } catch (e) {
    return { ...base, error: { name: 'Error', message: String(e), code: null } }
  }
  return new Promise((resolve) => {
    const child = fork(new URL('./worker.mjs', import.meta.url), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: []
    })
    let received: Outcome | null = null
    let settled = false
    let timedOut = false
    const finish = (status: Outcome['status']) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...base, ...received, status, stdout: base.stdout, stderr: base.stderr })
    }
    const timer = setTimeout(() => {
      timedOut = true
      received = null
      child.kill('SIGKILL')
    }, spec.timeoutMs)
    child.stdout?.on('data', (d) => {
      base.stdout += String(d)
    })
    child.stderr?.on('data', (d) => {
      base.stderr += String(d)
    })
    child.on('message', (message) => {
      try {
        assertJson(message)
        const m = message as Outcome
        if (
          received ||
          !['returned', 'threw', 'protocol-error'].includes(m.status) ||
          !Array.isArray(m.trace)
        )
          throw new Error('Invalid worker protocol')
        received = m
      } catch (e) {
        received = { ...base, error: { name: 'Error', message: String(e), code: null } }
        child.kill('SIGKILL')
      }
    })
    child.on('error', (e) => {
      base.stderr += String(e)
      finish('crashed')
    })
    child.on('close', (code, signal) =>
      finish(
        timedOut ? 'timeout' : code !== 0 || signal ? 'crashed' : (received?.status ?? 'crashed')
      )
    )
    child.send({ targetEntry, spec }, (error) => {
      if (error) {
        base.stderr += String(error)
        child.kill('SIGKILL')
      }
    })
  })
}
