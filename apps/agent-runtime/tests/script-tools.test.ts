import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolCall } from '@actiondriver/runtime-contracts'
import { createScriptTools } from '../src/execution/tools'
import { z } from 'zod'

async function collect(tool: Awaited<ReturnType<typeof createScriptTools>>[number], args: Record<string, unknown>) {
  const call: ToolCall = {
    callId: 'test', providerCallId: 'provider-test', modelName: tool.definition.modelName,
    arguments: args as ToolCall['arguments']
  }
  const events = []
  for await (const event of tool.executor.execute(call)) events.push(event)
  return events
}

describe('independent script tools', () => {
  it('runs shell syntax, Python standard library and Node built-ins from bundled paths', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'actiondriver-tools-'))
    const tools = await createScriptTools({ workspaceRoot, runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    expect(tools.map((tool) => tool.definition.modelName)).toEqual(['shell_run', 'python_run', 'node_run', 'ts_run'])
    expect(tools.map((tool) => tool.definition.timeoutMs)).toEqual([120_000, 120_000, 120_000, 120_000])
    const shell = tools[0]!
    const python = tools[1]!
    const node = tools[2]!
    const ts = tools[3]!
    expect(JSON.stringify(await collect(shell, { script: 'printf needle | rg needle' }))).toContain('needle')
    expect(JSON.stringify(await collect(shell, { script: 'printf needle > redirected.txt && rg needle redirected.txt' }))).toContain('needle')
    const py = JSON.stringify(await collect(python, { script: 'import json,sys; print(json.dumps({"executable":sys.executable}))' }))
    expect(py).toContain('/dist/runtimes/darwin-')
    const js = JSON.stringify(await collect(node, { script: "console.log(require('node:fs') !== undefined, process.execPath)" }))
    expect(js).toContain('/dist/runtimes/darwin-')
    expect(JSON.stringify(await collect(python, { script: 'import sys; print(sys.argv[1])', args: ['argument'] }))).toContain('argument')
    expect(JSON.stringify(await collect(node, { script: 'console.log(process.argv[2])', args: ['argument'] }))).toContain('argument')
    expect(JSON.stringify(await collect(ts, { script: 'const value: string = "typed"; console.log(value)' }))).toContain('typed')
  })

  it('rejects ambiguous script input before spawning', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'actiondriver-tools-invalid-'))
    const tools = await createScriptTools({ workspaceRoot, runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    for (const tool of tools) {
      const schema = z.fromJSONSchema(tool.definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse({ code: 'x' }).success).toBe(false)
      expect(schema.safeParse({ file: 'x' }).success).toBe(false)
      expect(schema.safeParse({ command: 'x' }).success).toBe(false)
      expect(schema.safeParse({ script: 'x' }).success).toBe(true)
      await expect(collect(tool, {})).rejects.toThrow('TOOL_INPUT_INVALID')
      await expect(collect(tool, { script: ' ' })).rejects.toThrow('TOOL_INPUT_INVALID')
    }
  })

  it('reports unsupported TypeScript syntax without invoking a system compiler', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'actiondriver-tools-ts-'))
    const tools = await createScriptTools({ workspaceRoot, runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    const ts = tools.find((tool) => tool.definition.modelName === 'ts_run')!
    await expect(collect(ts, { script: 'enum Color { Red }\nconsole.log(Color.Red)' }))
      .rejects.toThrow('PROCESS_EXIT_NONZERO')
  })
})
