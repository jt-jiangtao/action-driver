import { expect, it } from 'vitest'
import { catalog } from '../../src/catalog'
it('exposes image limits and existing authorization identity without provider access', () => {
  expect(catalog.tools[0]).toMatchObject({ id: 'tools/local/image-generation/generate', version: 1, modelName: 'tools_local_image_generation_generate', timeoutMs: 600000, inputSchema: { properties: { images: { minItems: 1, maxItems: 16 } } } })
})
