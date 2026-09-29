import { expect, it } from 'vitest'
import { catalog } from './catalog'
it('exposes the existing bounded public-page schema separately from execution', () => {
  expect(catalog.tools[0]).toMatchObject({ id: 'tools/local/web/open', version: 1, modelName: 'tools_local_web_open', timeoutMs: 30000, inputSchema: { required: ['url'], additionalProperties: false } })
})
