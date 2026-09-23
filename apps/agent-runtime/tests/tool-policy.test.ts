import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolDefinition } from '@actiondriver/runtime-contracts'
import { RuntimeToolPolicy, hashToolArguments } from '../src/tool-policy'

const readTool: ToolDefinition = {
  id: 'sandbox.fs.read',
  version: 1,
  modelName: 'sandbox_fs_read',
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
    expect(policy.discover([readTool, shellTool], { grants: ['sandbox.fs.read@1'] })).toEqual([
      readTool
    ])

    const denied = policy.decide(shellTool, call(shellTool, { command: 'rg' }), {
      grants: ['sandbox.fs.read@1']
    })
    expect(denied).toMatchObject({ kind: 'deny', error: { code: 'TOOL_DENIED' } })
  })

  it('allows low-risk reads and binds shell approval to canonical arguments', () => {
    const policy = new RuntimeToolPolicy()
    const grants = ['sandbox.fs.read@1', 'sandbox.shell.run@1']
    expect(policy.decide(readTool, call(readTool, { path: 'README.md' }), { grants })).toEqual({
      kind: 'allow'
    })

    const first = policy.decide(shellTool, call(shellTool, { args: ['x'], command: 'rg' }), {
      grants
    })
    const reordered = policy.decide(
      shellTool,
      call(shellTool, { command: 'rg', args: ['x'] }),
      { grants }
    )
    const changed = policy.decide(shellTool, call(shellTool, { command: 'rg', args: ['y'] }), {
      grants
    })
    expect(first).toEqual(reordered)
    expect(first).toEqual({
      kind: 'require_approval',
      argumentsHash: hashToolArguments({ command: 'rg', args: ['x'] })
    })
    expect(changed).not.toEqual(first)
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
