import { expect, it } from 'vitest'
import { createCommandCatalog } from './catalog'
it('exposes existing script schemas without creating an execution environment', () => {
  expect(createCommandCatalog().tools.map(tool => `${tool.id}@${tool.version}`)).toEqual(['local.shell.run@2', 'local.python.run@2', 'local.node.run@2', 'local.typescript.run@2'])
  expect(createCommandCatalog(2500).tools[0]).toMatchObject({ modelName: 'shell_run', timeoutMs: 2500, inputSchema: { required: ['script'], additionalProperties: false } })
})
