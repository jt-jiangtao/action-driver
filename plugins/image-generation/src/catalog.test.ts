import { expect, it } from 'vitest'
import { catalog } from './catalog'
it('exposes image limits and existing authorization identity without provider access', () => {
  expect(catalog.tools[0]).toMatchObject({ id: 'image.generate', version: 1, modelName: 'image_generate', timeoutMs: 600000, inputSchema: { properties: { images: { minItems: 1, maxItems: 16 } } } })
})
