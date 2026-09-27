import { it, expect } from 'vitest'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { catalog } from '../../../plugins/web/src/catalog'
const definition = { id: 'tools.local.command.node.run', modelName: 'tools.local.command.node.run', version: 2, description: 'Node', inputSchema: { type: 'object' }, risk: 'low' as const, sideEffects: { filesystem: 'none' as const, network: false }, timeoutMs: 1000 }
const executor = { async *execute() { yield { kind: 'result' as const, output: null } } }
it('publishes only dotted public identities', () => {
  expect(catalog.tools.map(tool => [tool.id, tool.modelName])).toEqual([
    ['tools.local.web.search', 'tools.local.web.search'], ['tools.local.web.open', 'tools.local.web.open']
  ])
})
it('does not register unpublished old names or fallback cloud calls', () => {
  const registry = new RuntimeToolRegistry()
  const resource = registry.register(definition, executor)
  expect(registry.resolveModelName(definition.modelName).definition).toEqual(definition)
  for (const name of ['node_run', 'tools_local_command_node_run', 'tools.cloud.command.node.run'])
    expect(() => registry.resolveModelName(name)).toThrow('TOOL_UNAVAILABLE')
  expect(() => registry.resolve('local.node.run', 2)).toThrow('TOOL_UNAVAILABLE')
  resource.dispose()
  expect(() => registry.resolveModelName(definition.modelName)).toThrow('TOOL_UNAVAILABLE')
})
it('requires exact public names and target-specific grants', () => {
  const policy = new RuntimeToolPolicy()
  const call = { callId: 'c', providerCallId: 'p', modelName: definition.modelName, arguments: {} }
  expect(policy.decide(definition, call, { grants: ['tools.local.command.node.run@2'] })).toEqual({ kind: 'allow' })
  expect(policy.decide(definition, call, { grants: ['local.node.run@2'] }).kind).toBe('deny')
  expect(policy.decide(definition, { ...call, modelName: 'tools_local_command_node_run' }, { grants: ['tools.local.command.node.run@2'] }).kind).toBe('deny')
  const cloud = { ...definition, id: 'tools.cloud.command.node.run', modelName: 'tools.cloud.command.node.run' }
  expect(policy.discover([cloud], { grants: ['tools.local.command.node.run@2'] })).toEqual([])
})
