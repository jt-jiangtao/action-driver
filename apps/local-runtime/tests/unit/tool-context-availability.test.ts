import { expect, it } from 'vitest'
import { RuntimeToolRegistry } from '@action-driver/agent-runtime/tool-registry'

const definition = {
  id: 'tools/local/fixture/run', version: 1, modelName: 'tools_local_fixture_run', description: 'Run fixture',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, risk: 'low' as const,
  sideEffects: { filesystem: 'none' as const, network: false }, timeoutMs: 1000
}

it('refreshes tool discovery from live availability without re-registering', () => {
  const registry = new RuntimeToolRegistry()
  let available = false
  const registration = registry.register(definition, { async *execute() { yield { kind: 'result' as const, output: 'ran' } } }, undefined, () => available)
  expect(registry.list()).toEqual([])
  available = true
  expect(registry.list().map(tool => tool.id)).toEqual([definition.id])
  available = false
  expect(registry.list()).toEqual([])
  registration.dispose()
})
