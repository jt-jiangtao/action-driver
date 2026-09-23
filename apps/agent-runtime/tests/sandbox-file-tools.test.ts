import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSandboxFileTools } from '../src/sandbox/file-tools'
import { SandboxPathGuard } from '../src/sandbox/path-guard'

describe('sandbox file tools', () => {
  it('lists direct entries in stable order and reads a bounded UTF-8 range', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-file-tools-'))
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'z.txt'), '0123456789')
    await writeFile(join(root, 'a.txt'), 'a')
    const tools = createSandboxFileTools(await SandboxPathGuard.create(root), { maxReadBytes: 4 })
    const listing = await collect(tools.list.executor.execute(call('sandbox_fs_list', { path: '.' })))
    expect(listing.at(-1)).toMatchObject({
      kind: 'result',
      output: { entries: [
        { name: 'a.txt', type: 'file' },
        { name: 'sub', type: 'directory' },
        { name: 'z.txt', type: 'file' }
      ] }
    })
    const read = await collect(tools.read.executor.execute(call('sandbox_fs_read', { path: 'z.txt' })))
    expect(read.at(-1)).toMatchObject({
      kind: 'result',
      output: { content: '0123', size: 10, truncated: true, range: { start: 0, end: 4 } }
    })
  })

  it('limits a directory listing to 1,000 entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'actiondriver-file-list-limit-'))
    await Promise.all(Array.from({ length: 1_002 }, (_, index) =>
      writeFile(join(root, `entry-${String(index).padStart(4, '0')}.txt`), '')
    ))
    const tools = createSandboxFileTools(await SandboxPathGuard.create(root))
    const events = await collect(tools.list.executor.execute(call('sandbox_fs_list', { path: '.' })))
    const output = (events.at(-1) as { output: { entries: unknown[]; truncated: boolean; totalEntries: number } }).output
    expect(output.entries).toHaveLength(1_000)
    expect(output).toMatchObject({ truncated: true, totalEntries: 1_002 })
  })
})

function call(modelName: string, args: Record<string, unknown>) {
  return {
    callId: 'call-1', providerCallId: 'provider-1', modelName,
    arguments: args
  } as Parameters<ReturnType<typeof createSandboxFileTools>['read']['executor']['execute']>[0]
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}
