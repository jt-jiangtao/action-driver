import { expect, it } from 'vitest'
import { RuntimeToolRegistry } from '../src/tool-registry'
import { RuntimeToolPolicy } from '../src/tool-policy'
import { catalog } from '../../../plugins/web/src/catalog'
const definition = { id: 'tools.local.command.node.run', modelName: 'tools_local_command_node_run', version: 2, description: 'Node', inputSchema: { type: 'object' }, risk: 'low' as const, sideEffects: { filesystem: 'none' as const, network: false }, timeoutMs: 1000 }
const executor = { async *execute() { yield { kind: 'result' as const, output: null } } }
it('publishes target and plugin qualified web names', () => {
  expect(catalog.tools.map(tool => [tool.id, tool.modelName])).toEqual([
    ['tools.local.web.search', 'tools_local_web_search'], ['tools.local.web.open', 'tools_local_web_open']
  ])
})
it('resolves old local names without adding discovery items and withdraws aliases on stop', () => {
  const registry = new RuntimeToolRegistry()
  const resource = registry.register(definition, executor)
  expect(registry.resolve('local.node.run', 2).definition).toEqual(definition)
  expect(registry.resolveModelName('node_run').definition).toEqual(definition)
  expect(registry.list()).toEqual([definition])
  expect(() => registry.resolve('local.node.run', 1)).toThrow('TOOL_UNAVAILABLE')
  resource.dispose()
  expect(() => registry.resolveModelName('node_run')).toThrow('TOOL_UNAVAILABLE')
})
it('supports legacy grants and names only for their original local target', () => {
  const policy = new RuntimeToolPolicy()
  const call = { callId: 'c', providerCallId: 'p', modelName: 'node_run', arguments: {} }
  expect(policy.decide(definition, call, { grants: ['local.node.run@2'] })).toEqual({ kind: 'allow' })
  expect(policy.discover([definition], { grants: ['local.node.run@2'] })).toEqual([definition])
  const cloud = { ...definition, id: 'tools.cloud.command.node.run', modelName: 'tools_cloud_command_node_run' }
  expect(policy.decide(cloud, { ...call, modelName: cloud.modelName }, { grants: ['local.node.run@2'] }).kind).toBe('deny')
  expect(policy.discover([cloud], { grants: ['tools.local.command.node.run@2'] })).toEqual([])
})
it('rejects reserved legacy model aliases instead of exposing ambiguous tools', () => {
  const registry = new RuntimeToolRegistry()
  registry.register({ ...definition, id: 'external.node', modelName: 'node_run' }, executor)
  expect(() => registry.register(definition, executor)).toThrow('CONFLICT')
})
it('renders legacy activity labels without changing the stored identity', async () => {
  const { toolActivityTitle, toolActivityResultSummary } = await import('../src/tool-activity')
  const { activityTitleForTool } = await import('../src/agent-graph')
  const stored = { toolId: 'web.open@1' }
  expect(toolActivityTitle(stored.toolId, { url: 'https://example.com/' }, 'completed')).toBe('已读取网页 example.com')
  expect(toolActivityResultSummary(stored.toolId, { title: 'Old page' })).toBe('Old page')
  expect(stored.toolId).toBe('web.open@1')
  expect(activityTitleForTool('node_run')).toBe('正在运行 Node.js')
  expect(activityTitleForTool('tools_local_command_python_run')).toBe('正在运行 Python')
  expect(activityTitleForTool('js')).toBe('正在操作桌面应用')
})
it('does not resolve cloud identities through local aliases', () => {
  const registry = new RuntimeToolRegistry(); registry.register(definition, executor)
  expect(() => registry.resolve('tools.cloud.command.node.run', 2)).toThrow('TOOL_UNAVAILABLE')
  expect(() => registry.resolveModelName('tools_cloud_command_node_run')).toThrow('TOOL_UNAVAILABLE')
})
