import { expect, it, vi } from 'vitest'
import { catalog } from '../../src/catalog'
import { activate } from '../../src/extension'

it('publishes Browser Use instructions for the shared CUA JS tool only', () => {
  expect(catalog.tools).toEqual([])
  expect(catalog.skills[0]?.content).toContain('cua.createBrowserTab')
  expect(catalog.skills[0]?.content).toContain('"chrome"')
  const register = vi.fn()
  activate({ api: { skills: { register } } } as unknown as Parameters<typeof activate>[0])
  expect(register).toHaveBeenCalledOnce()
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: 'browser-use' }))
})
