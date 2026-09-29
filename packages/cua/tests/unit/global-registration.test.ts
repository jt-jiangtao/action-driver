// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as candidate from '../../src/global-registration'
let sequence = 0
async function originalRegistration(create: (options: any) => Promise<any>) {
  vi.stubGlobal('__testCreateCUA', create)
  const source = await readFile(
    resolve(
      'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/globals.js'
    ),
    'utf8'
  )
  const adapted = source.replace(
    'import{create_tinysky_alt as e}from"./create_tinysky_alt.js";',
    'const e=globalThis.__testCreateCUA;'
  )
  if (adapted === source) throw new Error('Original factory import shape changed')
  await import(
    'data:text/javascript;base64,' +
      Buffer.from(adapted + `\n// isolated evaluation ${sequence++}`).toString('base64')
  )
}
async function compare(run: (register: any) => Promise<unknown>) {
  const expected = await run(originalRegistration)
  expect(await run((create: any) => (candidate as any).registerCUAGlobal(create,
    Reflect.get(globalThis, 'nodeRepl')?.env ?? {}))).toEqual(expected)
}
test('global registration parses enabled surfaces, trims duplicates and preserves runtime identity', async () => {
  await compare(async (register) => {
    const results = []
    for (const value of ['browser', 'computer', ' browser,computer,browser, ,computer ']) {
      const options: any[] = [],
        getState = function (this: any) {
          return this.id
        }
      const runtime = { id: 'runtime', getState, initialize: () => 'old' }
      vi.stubGlobal('nodeRepl', { env: { CUA_REPL_ENABLED_SURFACES: value } })
      vi.stubGlobal('cua', { id: 'previous' })
      try {
        await register(async (input: any) => {
          options.push(input)
          return runtime
        })
        const registered = (globalThis as any).cua
        results.push({
          options,
          same: registered === runtime,
          initializeSame: registered.initialize === getState,
          initialized: registered.initialize(),
          keys: Reflect.ownKeys(registered)
        })
      } finally {
        vi.unstubAllGlobals()
      }
    }
    return results
  })
})
test('invalid or missing surface configuration rejects before factory and preserves old global', async () => {
  await compare(async (register) => {
    const results = []
    for (const host of [
      undefined,
      {},
      { env: {} },
      ...['', ', ,', 'browser,unknown', 'Computer', 'unknown,browser'].map((value) => ({
        env: { CUA_REPL_ENABLED_SURFACES: value }
      }))
    ]) {
      let calls = 0,
        error
      const previous = {}
      vi.stubGlobal('nodeRepl', host)
      vi.stubGlobal('cua', previous)
      try {
        await register(async () => {
          calls++
          return {}
        })
      } catch (e) {
        error = (e as Error).message
      } finally {
        results.push({ calls, error, unchanged: (globalThis as any).cua === previous })
        vi.unstubAllGlobals()
      }
    }
    return results
  })
})
test('factory rejection leaves previous CUA global untouched', async () => {
  await compare(async (register) => {
    const previous = {},
      calls: any[] = []
    vi.stubGlobal('nodeRepl', { env: { CUA_REPL_ENABLED_SURFACES: 'computer' } })
    vi.stubGlobal('cua', previous)
    try {
      let error
      try {
        await register(async (options: any) => {
          calls.push(options)
          throw new Error('runtime creation failed')
        })
      } catch (e) {
        error = (e as Error).message
      }
      return { calls, error, unchanged: (globalThis as any).cua === previous }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
test('global registration waits for runtime creation and snapshots surface selection', async () => {
  await compare(async (register) => {
    const previous = {},
      runtime = { getState: () => 'state' },
      calls: any[] = []
    const host = { env: { CUA_REPL_ENABLED_SURFACES: 'browser' } }
    let release!: (runtime: any) => void, entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    vi.stubGlobal('nodeRepl', host)
    vi.stubGlobal('cua', previous)
    try {
      const pending = register((options: any) => {
        calls.push(options)
        entered()
        return new Promise((resolve) => {
          release = resolve
        })
      })
      await ready
      const before = (globalThis as any).cua === previous
      host.env.CUA_REPL_ENABLED_SURFACES = 'computer'
      release(runtime)
      await pending
      return { before, calls, after: (globalThis as any).cua === runtime }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

test('registration uses explicit ActionDriver surface settings and ignores ambient private host', async () => {
  vi.stubGlobal('nodeRepl', { env: { CUA_REPL_ENABLED_SURFACES: 'computer' } })
  const seen: unknown[] = []
  try {
    await candidate.registerCUAGlobal(async (enabled) => {
      seen.push(enabled)
      return { getState: () => null }
    }, { CUA_REPL_ENABLED_SURFACES: 'browser' })
    expect(seen).toEqual([{ browser: true, computer: false }])
  } finally {
    vi.unstubAllGlobals()
  }
})
