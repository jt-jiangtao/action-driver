// @vitest-environment node
import { expect, test } from 'vitest'
import { resolve } from 'node:path'
import { originalModule } from '../../cua/tests/original-module'
import { windowResult } from '../src/mac/window-result'
import type { WindowAppState } from '../src/mac/types'
const path = resolve(
  'packages/back/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/mac/window_result.js'
)
test('screenshot and once-per-app instructions match original including Numbers exclusion', async () => {
  const ref = await originalModule(path)
  const own = new Set<string>(),
    original = new Set<string>()
  for (const app of ['a', 'a', 'b', 'com.apple.iWork.Numbers', 'c'])
    for (const screenshot of [null, { url: null }, { url: '' }, { url: 'file:///image.png' }]) {
      const input: WindowAppState = {
        app: { bundleIdentifier: app },
        skyshot: { text: 'state', screenshot },
        appSpecificInstructions: 'instructions'
      }
      expect(await windowResult('canonical', input, own)).toEqual(
        await ref.window_result!('canonical', input, original)
      )
      expect([...own]).toEqual([...original])
    }
})
test('instruction deduplication falls back to string app then input app', async () => {
  const set = new Set<string>()
  const input = {
    app: 'service-app',
    skyshot: { text: 'state' },
    appSpecificInstructions: 'instructions'
  }
  expect((await windowResult('input', input, set)).text).toContain('<app_specific_instructions>')
  expect((await windowResult('other-input', input, set)).text).toBe('state')
  expect([...set]).toEqual(['service-app'])
  expect((await windowResult('fallback', { ...input, app: {} }, set)).text).toContain(
    '<app_specific_instructions>'
  )
})
test('missing skyshot, invalid URL/text/instructions fail before mutating delivery state', async () => {
  const ref = await originalModule(path)
  for (const input of [
    { app: 'a' },
    { app: 'a', skyshot: { text: 'ok', screenshot: { url: 1 } } },
    { app: 'a', skyshot: { text: 1 } },
    { app: 'a', skyshot: { text: 'ok' }, appSpecificInstructions: 1 }
  ]) {
    const set = new Set<string>()
    let error: Error | undefined
    try {
      await ref.window_result!('a', input, new Set())
    } catch (e) {
      error = e as Error
    }
    await expect(windowResult('a', input as never, set)).rejects.toThrow(error!.message)
    expect(set.size).toBe(0)
  }
})
