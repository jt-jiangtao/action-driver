import { expect, it } from 'vitest'
import { catalog } from './catalog'
import { activate } from './extension'
it('publishes no operation tools without a real browser driver', () => {
  expect(catalog.tools).toEqual([])
  const register = () => { throw new Error('Unexpected placeholder contribution') }
  activate({ api: { tools: { register }, contributions: { register } } } as unknown as Parameters<typeof activate>[0])
})
