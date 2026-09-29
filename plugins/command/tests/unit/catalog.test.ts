import { expect, it } from 'vitest'
import { createCommandCatalog } from '../../src/catalog'
it('exposes existing script schemas without creating an execution environment', () => {
  expect(createCommandCatalog().tools.map(tool => `${tool.id}@${tool.version}`)).toEqual(['tools/local/command/shell/run@2', 'tools/local/command/python/run@2', 'tools/local/command/node/run@2', 'tools/local/command/typescript/run@2', 'tools/local/command/dependencies/load@1'])
  expect(createCommandCatalog(2500).tools[0]).toMatchObject({ modelName: 'tools_local_command_shell_run', timeoutMs: 2500, inputSchema: { required: ['script'], additionalProperties: false } })
})
