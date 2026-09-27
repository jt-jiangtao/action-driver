import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolDefinition } from '@actiondriver/runtime-contracts'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { createSearxngSearchTool } from '../src/searxng/search-tool'

const readTool: ToolDefinition = {
  id: 'tools.local.command.shell.run',
  version: 1,
  modelName: 'tools.local.command.shell.run',
  description: 'Read one workspace file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  risk: 'low',
  sideEffects: { filesystem: 'read', network: false },
  timeoutMs: 1_000
}

const shellTool: ToolDefinition = {
  ...readTool,
  id: 'sandbox.shell.run',
  modelName: 'sandbox_shell_run',
  risk: 'medium'
}

describe('RuntimeToolPolicy', () => {
  it('only exposes explicitly granted tools and denies calls outside the grant', () => {
    const policy = new RuntimeToolPolicy()
    expect(policy.discover([readTool, shellTool], { grants: ['tools.local.command.shell.run@1'] })).toEqual([
      readTool
    ])

    const denied = policy.decide(shellTool, call(shellTool, { command: 'rg' }), {
      grants: ['tools.local.command.shell.run@1']
    })
    expect(denied).toMatchObject({ kind: 'deny', error: { code: 'TOOL_DENIED' } })
  })

  it('allows granted reads and shell calls without per-call approval', () => {
    const policy = new RuntimeToolPolicy()
    const grants = ['tools.local.command.shell.run@1', 'sandbox.shell.run@1']
    expect(policy.decide(readTool, call(readTool, { path: 'README.md' }), { grants })).toEqual({
      kind: 'allow'
    })

    expect(
      policy.decide(shellTool, call(shellTool, { command: 'rg', args: ['x'] }), { grants })
    ).toEqual({ kind: 'allow' })
    expect(
      policy.decide(shellTool, call(shellTool, { command: 'rg', args: ['y'] }), { grants })
    ).toEqual({ kind: 'allow' })
    expect(
      policy.decide(shellTool, { ...call(shellTool, {}), modelName: 'wrong' }, { grants })
    ).toMatchObject({
      kind: 'deny',
      error: { code: 'TOOL_DEFINITION_MISMATCH' }
    })
  })

  it('allows each granted local SearXNG search without an approval state', () => {
    const definition = createSearxngSearchTool({ endpoint: 'http://127.0.0.1:8080' }).definition
    const policy = new RuntimeToolPolicy()
    const first = policy.decide(definition, call(definition, { query: 'first' }), {
      grants: ['tools.local.web.search@1']
    })
    const second = policy.decide(definition, call(definition, { query: 'second' }), {
      grants: ['tools.local.web.search@1']
    })
    expect(first).toEqual({ kind: 'allow' })
    expect(second).toEqual({ kind: 'allow' })
  })
})

function call(definition: ToolDefinition, args: ToolCall['arguments']): ToolCall {
  return {
    callId: 'call-1',
    providerCallId: 'provider-1',
    modelName: definition.modelName,
    arguments: args
  }
}
