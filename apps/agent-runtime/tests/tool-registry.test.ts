import { describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolExecutor } from '@actiondriver/runtime-contracts'
import { RuntimeToolRegistry, ToolRegistryError } from '../src/tool-registry'

const executor: ToolExecutor = {
  async *execute() {
    yield { kind: 'result', output: { ok: true } }
  }
}

const readTool: ToolDefinition = {
  id: 'tools.local.command.shell.run',
  version: 1,
  modelName: 'tools_local_command_shell_run',
  description: 'Read a workspace file',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false
  },
  risk: 'low',
  sideEffects: { filesystem: 'read', network: false },
  timeoutMs: 10_000
}

describe('RuntimeToolRegistry', () => {
  it('resolves one registered model name to its versioned tool and executor', () => {
    const registry = new RuntimeToolRegistry()
    registry.register(readTool, executor)

    expect(registry.resolveModelName('tools_local_command_shell_run')).toEqual({ definition: readTool, executor })
    expect(registry.resolve('tools.local.command.shell.run', 1)).toEqual({ definition: readTool, executor })
  })

  it('rejects duplicate model names without replacing the first registration', () => {
    const registry = new RuntimeToolRegistry()
    registry.register(readTool, executor)

    expect(() =>
      registry.register(
        { ...readTool, id: 'tools.local.command.node.run', modelName: readTool.modelName },
        executor
      )
    ).toThrow('TOOL_MODEL_NAME_CONFLICT')
    expect(registry.resolveModelName(readTool.modelName).definition.id).toBe(readTool.id)
  })

  it.each([
    { ...readTool, version: 0 },
    { ...readTool, modelName: 'contains.dot' },
    { ...readTool, inputSchema: { type: 'string' } },
    { ...readTool, inputSchema: { type: 'object', default: () => undefined } }
  ])('rejects invalid tool definitions', (invalid) => {
    expect(() => new RuntimeToolRegistry().register(invalid as ToolDefinition, executor)).toThrow(
      ToolRegistryError
    )
  })

  it('returns a stable error for unknown or mismatched tools', () => {
    const registry = new RuntimeToolRegistry()
    registry.register(readTool, executor)

    expect(() => registry.resolveModelName('unknown')).toThrow('TOOL_UNAVAILABLE')
    expect(() => registry.resolve(readTool.id, 2)).toThrow('TOOL_UNAVAILABLE')
  })
})
describe('plugin owned registrations', () => {
  it('rejects duplicate owners and disposes only its exact registration', () => {
    const registry = new RuntimeToolRegistry()
    const owner = { pluginId: 'search', version: '1.0.0', hostEpoch: 'a' }
    const registration = registry.register(readTool, executor, owner)
    expect(() => registry.register(readTool, executor, { ...owner, pluginId: 'other' })).toThrow('search')
    expect(registry.resolve(readTool.id, 1).owner).toEqual(owner)
    registration.dispose()
    expect(() => registry.resolve(readTool.id, 1)).toThrow('TOOL_UNAVAILABLE')
    const next = registry.register(readTool, executor, { ...owner, hostEpoch: 'b' })
    registration.dispose()
    expect(registry.resolve(readTool.id, 1).owner?.hostEpoch).toBe('b')
    next.dispose()
  })
})
