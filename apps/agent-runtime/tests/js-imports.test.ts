import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function evaluate(code: string): Promise<{ ok: boolean; error?: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-vm-modules', '--no-warnings',
      join(process.cwd(), 'apps/agent-runtime/resources/js-repl/repl-server.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buffer = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Child timed out')) }, 3000)
    child.stdout.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop()!
      for (const line of lines) {
        const message = JSON.parse(line)
        if (message.id === 1 && typeof message.ok === 'boolean') {
          clearTimeout(timer); child.kill(); resolve(message)
        }
      }
    })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.stdin.write(JSON.stringify({ id: 1, code }) + '\n')
  })
}

describe('model module imports', () => {
  it.each(['child_process', 'worker_threads', 'cluster', 'inspector', 'process'])('rejects %s and its node alias', async name => {
    for (const module of [name, `node:${name}`]) {
      const result = await evaluate(`await import(${JSON.stringify(module)})`)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('unavailable')
    }
  })
  it('keeps file reads available subject to the system sandbox', async () => {
    expect((await evaluate('const fs = await import("node:fs/promises")')).ok).toBe(true)
  })
})
