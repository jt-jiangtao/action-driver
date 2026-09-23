import { spawn, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSandboxShellTool } from '../src/sandbox/shell-tool'
import { SandboxPathGuard } from '../src/sandbox/path-guard'
import { createSandboxTools } from '../src/sandbox'

describe('sandbox shell tool', () => {
  it('uses a fixed binary, no shell and a secret-free environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-shell-'))
    await writeFile(join(root, 'a.txt'), 'first\nsecond\n')
    const spawnProcess = vi.fn((file: string, args: string[], options: SpawnOptions) =>
      spawn(file, args, options)
    )
    const tool = createSandboxShellTool(await SandboxPathGuard.create(root), {
      executables: {
        wc: '/usr/bin/wc',
        head: '/usr/bin/head',
        tail: '/usr/bin/tail',
        rg: '/usr/bin/rg'
      },
      spawnProcess
    })
    const events = await collect(tool.executor.execute(call('wc', ['-l', 'a.txt'])))
    expect(events.at(-1)).toMatchObject({ kind: 'result', output: { exitCode: 0 } })
    expect(spawnProcess).toHaveBeenCalledWith(
      '/usr/bin/wc',
      ['-l', '--', expect.stringContaining('a.txt')],
      expect.objectContaining({
        shell: false,
        cwd: await realpath(root),
        env: {
          PATH: '/usr/bin:/bin',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8'
        }
      })
    )
  })

  it('rejects unknown commands, flags, shell syntax and escaping paths before spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-shell-deny-'))
    await writeFile(join(root, 'a.txt'), 'text')
    const spawnProcess = vi.fn((file: string, args: string[], options: SpawnOptions) =>
      spawn(file, args, options)
    )
    const tool = createSandboxShellTool(await SandboxPathGuard.create(root), {
      executables: {
        wc: '/usr/bin/wc',
        head: '/usr/bin/head',
        tail: '/usr/bin/tail',
        rg: '/usr/bin/rg'
      },
      spawnProcess
    })
    for (const input of [
      call('curl', ['https://example.com']),
      call('sh', ['-c', 'echo hi']),
      call('rg', ['--pre', 'cat', 'a.txt']),
      call('rg', ['x', '../outside']),
      call('rg', ['x|cat', 'a.txt']),
      call('wc', ['-l', '/etc/passwd'])
    ]) {
      await expect(collect(tool.executor.execute(input))).rejects.toThrow(/SANDBOX_/)
    }
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('stops a process when output exceeds the configured limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-shell-limit-'))
    await writeFile(join(root, 'large.txt'), 'line\n'.repeat(100))
    const tool = createSandboxShellTool(await SandboxPathGuard.create(root), {
      executables: {
        wc: '/usr/bin/wc',
        head: '/usr/bin/head',
        tail: '/usr/bin/tail',
        rg: '/usr/bin/rg'
      },
      maxOutputBytes: 16
    })
    await expect(
      collect(tool.executor.execute(call('head', ['-n', '100', 'large.txt'])))
    ).rejects.toThrow('SANDBOX_OUTPUT_LIMIT')
  })

  it('waits for process close after a timeout before reporting failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-shell-timeout-'))
    await writeFile(join(root, 'a.txt'), 'text')
    let closed = false
    class PendingProcess extends EventEmitter {
      readonly stdout = new PassThrough()
      readonly stderr = new PassThrough()
      readonly pid = undefined
      kill() {
        closed = true
        queueMicrotask(() => this.emit('close', null))
        return true
      }
    }
    const pending = new PendingProcess()
    const tool = createSandboxShellTool(await SandboxPathGuard.create(root), {
      executables: {
        wc: '/usr/bin/wc',
        head: '/usr/bin/head',
        tail: '/usr/bin/tail',
        rg: '/usr/bin/rg'
      },
      timeoutMs: 5,
      spawnProcess: () => pending as unknown as ReturnType<typeof spawn>
    })
    await expect(collect(tool.executor.execute(call('wc', ['-l', 'a.txt'])))).rejects.toThrow(
      'SANDBOX_TIMEOUT'
    )
    expect(closed).toBe(true)
  })

  it('maps an allowed rg query to validated arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-shell-rg-'))
    await writeFile(join(root, 'a.txt'), 'needle')
    class CompletedProcess extends EventEmitter {
      readonly stdout = new PassThrough()
      readonly stderr = new PassThrough()
      readonly pid = undefined
      kill() {
        return true
      }
    }
    const child = new CompletedProcess()
    const spawnProcess = vi.fn((file: string, args: string[], options: SpawnOptions) => {
      void file
      void args
      void options
      queueMicrotask(() => child.emit('close', 0))
      return child as unknown as ReturnType<typeof spawn>
    })
    const tool = createSandboxShellTool(await SandboxPathGuard.create(root), {
      executables: {
        wc: '/usr/bin/wc',
        head: '/usr/bin/head',
        tail: '/usr/bin/tail',
        rg: '/usr/bin/rg'
      },
      spawnProcess
    })
    await collect(tool.executor.execute(call('rg', ['-n', 'needle', 'a.txt'])))
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual([
      '-n',
      '--',
      'needle',
      expect.stringContaining('a.txt')
    ])
  })

  it('runs the bundled ripgrep binary against a workspace file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-shell-bundled-rg-'))
    await writeFile(join(root, 'a.txt'), 'needle\nother\n')
    const tools = await createSandboxTools({ workspaceRoot: root })
    const shell = tools.find((tool) => tool.definition.id === 'sandbox.shell.run')!
    const events = await collect(shell.executor.execute(call('rg', ['-n', 'needle', 'a.txt'])))
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'content',
        stream: 'stdout',
        delta: expect.stringContaining('needle')
      })
    )
    expect(events.at(-1)).toMatchObject({ kind: 'result', output: { exitCode: 0 } })
  })
})

function call(command: string, args: string[]) {
  return {
    callId: 'call-1',
    providerCallId: 'provider-1',
    modelName: 'sandbox_shell_run',
    arguments: { command, args }
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = []
  for await (const event of iterable) events.push(event)
  return events
}
