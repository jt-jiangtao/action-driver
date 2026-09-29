import { describe, expect, it } from 'vitest'
import { runProcess } from '../../src/execution/process-runner'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spec = (code: string, maxOutputBytes = 1024) => ({
  executable: process.execPath, args: ['-e', code], cwd: process.cwd(), env: process.env,
  maxOutputBytes
})

async function collect(code: string, maxOutputBytes?: number) {
  const events = []
  for await (const event of runProcess(spec(code, maxOutputBytes))) events.push(event)
  return events
}

describe('script process runner', () => {
  it('executes source delivered through stdin', async () => {
    const events = []
    for await (const event of runProcess({
      ...spec(''), args: ['-'], stdin: 'console.log("stdin-ok")'
    })) events.push(event)
    expect(JSON.stringify(events)).toContain('stdin-ok')
  })

  it('rejects an oversized source before starting a process', async () => {
    const events = runProcess({
      ...spec(''), executable: '/missing-binary', args: ['-'], stdin: 'x'.repeat(2 * 1024 * 1024)
    })
    await expect(async () => { for await (const _ of events) void _ }).rejects.toThrow('PROCESS_INPUT_LIMIT')
  })

  it('settles when the child exits before consuming stdin', async () => {
    const events = runProcess({
      ...spec('process.exit(0)'), stdin: 'x'.repeat(512 * 1024)
    })
    await expect(async () => { for await (const _ of events) void _ }).rejects.toThrow()
  })

  it('cancels while a child is not consuming stdin', async () => {
    const controller = new AbortController()
    const iterator = runProcess({
      ...spec('setInterval(() => {}, 1000)'), stdin: 'x'.repeat(512 * 1024)
    }, controller.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    setTimeout(() => controller.abort(), 30)
    await expect(pending).rejects.toThrow('PROCESS_CANCELLED')
  })

  it('streams stdout and stderr and returns exit metadata', async () => {
    const events = await collect("process.stdout.write('ok');process.stderr.write('warn')")
    expect(events).toContainEqual({ kind: 'content', stream: 'stdout', delta: 'ok' })
    expect(events).toContainEqual({ kind: 'content', stream: 'stderr', delta: 'warn' })
    expect(events.at(-1)).toMatchObject({ kind: 'result', output: { exitCode: 0, byteLength: 6 } })
  })

  it('fails on nonzero exit and bounded output', async () => {
    await expect(collect('process.exit(7)')).rejects.toThrow('PROCESS_EXIT_NONZERO: 7')
    await expect(collect("process.stdout.write('abcdef')", 3)).rejects.toThrow('PROCESS_OUTPUT_LIMIT')
  })

  it('terminates when aborted', async () => {
    const controller = new AbortController()
    const iterator = runProcess(spec('setInterval(() => {}, 1000)'), controller.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toThrow('PROCESS_CANCELLED')
  })

  it('preserves UTF-8 across output chunks', async () => {
    const events = await collect("process.stdout.write(Buffer.from([0xe4,0xb8]));setTimeout(()=>process.stdout.write(Buffer.from([0xad])),10)")
    expect(events.map((event) => event.kind === 'content' ? event.delta : '').join('')).toBe('中')
  })

  it('terminates a child process in the same process group on cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'actiondriver-child-'))
    const pidFile = join(directory, 'pid')
    const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000)`
    const controller = new AbortController()
    const iterator = runProcess(spec(code), controller.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()
    let pid = 0
    for (let attempt = 0; attempt < 100; attempt++) {
      try { pid = Number(await readFile(pidFile, 'utf8')); break } catch { await new Promise((resolve) => setTimeout(resolve, 10)) }
    }
    expect(pid).toBeGreaterThan(0)
    controller.abort()
    await expect(pending).rejects.toThrow('PROCESS_CANCELLED')
    await expect.poll(() => {
      try { process.kill(pid, 0); return true } catch { return false }
    }).toBe(false)
  })
})
