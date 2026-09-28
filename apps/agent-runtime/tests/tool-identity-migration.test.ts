import { expect, it } from 'vitest'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { catalog } from '../../../plugins/web/src/catalog'
const definition = { id: 'tools/local/command/node/run', modelName: 'tools_local_command_node_run', version: 2, description: 'Node', inputSchema: { type: 'object' }, risk: 'low' as const, sideEffects: { filesystem: 'none' as const, network: false }, timeoutMs: 1000 }
const executor = { async *execute() { yield { kind: 'result' as const, output: null } } }
it('publishes target and plugin qualified web names', () => {
  expect(catalog.tools.map(tool => [tool.id, tool.modelName])).toEqual([
    ['tools/local/web/search', 'tools_local_web_search'], ['tools/local/web/open', 'tools_local_web_open']
  ])
})
it('resolves only the current slash identity and withdraws it on stop', () => {
  const registry = new RuntimeToolRegistry()
  const resource = registry.register(definition, executor)
  expect(registry.resolve('tools/local/command/node/run', 2).definition).toEqual(definition)
  expect(registry.resolveModelName('tools_local_command_node_run').definition).toEqual(definition)
  expect(registry.list()).toEqual([definition])
  expect(() => registry.resolve('local.node.run', 2)).toThrow('TOOL_UNAVAILABLE')
  expect(() => registry.resolveModelName('node_run')).toThrow('TOOL_UNAVAILABLE')
  expect(() => registry.resolve('local.node.run', 1)).toThrow('TOOL_UNAVAILABLE')
  resource.dispose()
  expect(() => registry.resolveModelName('tools_local_command_node_run')).toThrow('TOOL_UNAVAILABLE')
})
it('rejects old grants and preserves target isolation', () => {
  const policy = new RuntimeToolPolicy()
  const call = { callId: 'c', providerCallId: 'p', modelName: 'node_run', arguments: {} }
  expect(policy.decide(definition, call, { grants: ['local.node.run@2'] }).kind).toBe('deny')
  expect(policy.discover([definition], { grants: ['local.node.run@2'] })).toEqual([])
  expect(policy.decide(definition, call, { grants: ['tools/local/command/node/run@2'] })).toMatchObject({ kind: 'deny', error: { code: 'TOOL_DEFINITION_MISMATCH' } })
  const cloud = { ...definition, id: 'tools/cloud/command/node/run', modelName: 'tools_cloud_command_node_run' }
  expect(policy.decide(cloud, { ...call, modelName: cloud.modelName }, { grants: ['local.node.run@2'] }).kind).toBe('deny')
  expect(policy.discover([cloud], { grants: ['tools/local/command/node/run@2'] })).toEqual([])
})
it('does not reserve old model names for a different slash tool', () => {
  const registry = new RuntimeToolRegistry()
  registry.register({ ...definition, id: 'external/node', modelName: 'node_run' }, executor)
  registry.register(definition, executor)
  expect(registry.list()).toHaveLength(2)
})
it('keeps old activity identities as unrecognized historical data', async () => {
  const { toolActivityTitle, toolActivityResultSummary } = await import('../src/tool-activity')
  const { activityTitleForTool } = await import('../src/agent-graph')
  const stored = { toolId: 'web.open@1' }
  expect(toolActivityTitle(stored.toolId, { url: 'https://example.com/' }, 'completed')).toBe('已调用工具')
  expect(toolActivityResultSummary(stored.toolId, { title: 'Old page' })).toBe('工具已完成')
  expect(stored.toolId).toBe('web.open@1')
  expect(activityTitleForTool('tools_local_command_node_run')).toBe('正在运行 Node.js')
  expect(activityTitleForTool('tools_local_command_python_run')).toBe('正在运行 Python')
  expect(activityTitleForTool('tools_local_cua_js')).toBe('正在操作桌面应用')
})
it('does not resolve cloud identities through local aliases', () => {
  const registry = new RuntimeToolRegistry(); registry.register(definition, executor)
  expect(() => registry.resolve('tools/cloud/command/node/run', 2)).toThrow('TOOL_UNAVAILABLE')
  expect(() => registry.resolveModelName('tools_cloud_command_node_run')).toThrow('TOOL_UNAVAILABLE')
})
