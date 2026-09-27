import { expect, it } from 'vitest'
import { catalog } from './catalog'
it('exposes the existing bounded public-page schema separately from execution', () => {
  expect(catalog.tools[0]).toMatchObject({ id: 'web.open', version: 1, modelName: 'web_open', timeoutMs: 15000, inputSchema: { required: ['url'], additionalProperties: false } })
})
