// @vitest-environment node
import { test, expect } from 'vitest'
import { dispatchKeys, dispatchCharacter, clipboardShortcut } from '../../src/service-keyboard-input'
import { originalDocumentation } from '../original-service'
function fixture() {
  const calls: any[] = [],
    cdp = {
      platform: 'darwin',
      call: async (...args: any[]) => calls.push(['call', ...args]),
      callTarget: async (...args: any[]) => calls.push(['target', ...args])
    }
  return { calls, cdp }
}
test('all original key names, aliases and common chords dispatch matching macOS CDP events', async () => {
  const base = await originalDocumentation(),
    names = [
      ...base.baselineKeys.keys(),
      ...base.baselineKeyAliases.keys(),
      ...base.baselineKeyChords.keys(),
      'unknown',
      ''
    ]
  for (const name of names) {
    async function exercise(dispatch: any) {
      const f = fixture()
      let error
      try {
        await dispatch(f.cdp, 1, name)
      } catch (e: any) {
        error = e.message
      }
      return { calls: f.calls, error }
    }
    expect(await exercise(dispatchKeys), name).toEqual(await exercise(base.baselineDispatchKeys))
  }
})
test('native clipboard shortcuts are identified and blocked while allowed modifier combinations remain', async () => {
  const base = await originalDocumentation()
  for (const key of ['c', 'x', 'v', 'Insert', 'Delete', 'a'])
    for (const modifiers of [
      [],
      ['Meta'],
      ['Control'],
      ['Shift'],
      ['Meta', 'Shift'],
      ['Control', 'Shift'],
      ['Meta', 'Control']
    ]) {
      const keys = [...modifiers, key]
      expect(clipboardShortcut(keys)).toBe(base.baselineClipboardShortcut(keys, 'darwin'))
      async function exercise(dispatch: any) {
        const f = fixture()
        let error
        try {
          await dispatch(f.cdp, { tabId: 1, sessionId: 'frame' }, keys, {
            inputTargetToken: 'token',
            deadlineMs: 123
          })
        } catch (e: any) {
          error = e.message
        }
        return { calls: f.calls, error }
      }
      expect(await exercise(dispatchKeys)).toEqual(await exercise(base.baselineDispatchKeys))
    }
})
test('text character dispatch chooses insert-text for unsupported Unicode and validates cardinality', async () => {
  const base = await originalDocumentation()
  for (const character of ['a', 'A', 'é', '你', '😀', 'ab', '']) {
    async function exercise(dispatch: any) {
      const f = fixture()
      let error
      try {
        await dispatch(f.cdp, { tabId: 1, targetId: 'frame' }, character, {
          inputTargetToken: 'token'
        })
      } catch (e: any) {
        error = e.message
      }
      return { calls: f.calls, error }
    }
    expect(await exercise(dispatchCharacter)).toEqual(
      await exercise(base.baselineDispatchCharacter)
    )
  }
})

test('guard failure releases previously pressed modifiers and preserves the rejection', async () => {
  const base = await originalDocumentation()
  async function exercise(dispatch: typeof dispatchKeys) {
    const events: any[] = []
    let inspections = 0
    const cdp: any = {
      platform: 'darwin',
      call: async (_id: number, method: string, params: any) => {
        events.push([method, params])
      },
      callTarget: async (_target: unknown, method: string) => {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'top' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
        if (method === 'Runtime.evaluate') {
          if (++inspections === 2) throw Error('focus inspection failed')
          return { result: { subtype: 'null' } }
        }
        throw Error('unexpected method ' + method)
      }
    }
    let error
    try {
      await dispatch(cdp, 1, ['Shift', 'a'], { blockClosedShadowInput: true })
    } catch (e: any) {
      error = e.message
    }
    return { events, inspections, error }
  }
  const result = await exercise(dispatchKeys)
  expect(result).toEqual(await exercise(base.baselineDispatchKeys))
  expect(result.error).toBe('focus inspection failed')
  expect(result.events.map((event) => [event[1].type, event[1].key, event[1].modifiers])).toEqual([
    ['rawKeyDown', 'Shift', 8],
    ['keyUp', 'Shift', 0]
  ])
})
