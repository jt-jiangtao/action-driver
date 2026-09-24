import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
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
    expect(tools.map((tool) => tool.definition.modelName)).toEqual(['shell_run', 'python_run', 'node_run'])
    expect(tools.map((tool) => tool.definition.timeoutMs)).toEqual([120_000, 120_000, 120_000])
    const shell = tools[0]!
    const python = tools[1]!
    const node = tools[2]!
    expect(JSON.stringify(await collect(shell, { command: 'printf needle | rg needle' }))).toContain('needle')
    expect(JSON.stringify(await collect(shell, { command: 'printf needle > redirected.txt && rg needle redirected.txt' }))).toContain('needle')
    const py = JSON.stringify(await collect(python, { code: 'import json,sys; print(json.dumps({"executable":sys.executable}))' }))
    expect(py).toContain('/dist/runtimes/darwin-')
    const js = JSON.stringify(await collect(node, { code: "console.log(require('node:fs') !== undefined, process.execPath)" }))
    expect(js).toContain('/dist/runtimes/darwin-')
    await writeFile(join(workspaceRoot, 'script.py'), 'import sys; print(sys.argv[1])')
    expect(JSON.stringify(await collect(python, { file: 'script.py', args: ['argument'] }))).toContain('argument')
    await writeFile(join(workspaceRoot, 'script.js'), 'console.log(process.argv[2])')
    expect(JSON.stringify(await collect(node, { file: 'script.js', args: ['argument'] }))).toContain('argument')
  })

  it('rejects ambiguous script input before spawning', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'actiondriver-tools-invalid-'))
    const tools = await createScriptTools({ workspaceRoot, runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist') })
    for (const tool of tools.slice(1)) {
      const schema = z.fromJSONSchema(tool.definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse({ code: 'x', file: 'y' }).success).toBe(false)
      expect(schema.safeParse({ code: 'x' }).success).toBe(true)
      await expect(collect(tool, {})).rejects.toThrow('TOOL_INPUT_INVALID')
      await expect(collect(tool, { code: 'x', file: 'y' })).rejects.toThrow('TOOL_INPUT_INVALID')
    }
  })
})
