// @vitest-environment node
import { expect, test } from 'vitest'
import { createComputerSession } from '../../src/computer-session'
import type { MacComputer, SessionHost } from '../../src/computer-session'
import { originalComputerSession } from '../original-computer-session'
function fixture(screenshot: { url: string } | null = { url: 'data:image/png;base64,AQID' }) {
  const calls: Array<{ method: string; input: unknown }> = []
  const output: unknown[] = []
  const action = (method: string) => async (input: unknown) => {
    calls.push({ method, input })
  }
  const computer: MacComputer = {
    target: 'mac',
    list_apps: async () => [{ id: 'app' }],
    get_app_state: async (input) => {
      calls.push({ method: 'get_app_state', input })
      return { app: 'canonical.app', text: 'state', screenshot }
    },
    click: action('click'),
    drag: action('drag'),
    paste: action('paste'),
    press_key: action('press_key'),
    scroll: action('scroll'),
    select_text: action('select_text'),
    set_value: action('set_value'),
    type_text: action('type_text'),
    perform_secondary_action: action('perform_secondary_action')
  }
  let meta: unknown = {}
  const host: SessionHost = {
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' },
    get requestMeta() {
      return meta
    },
    write: (text, id) => {
      output.push({ text, id })
    },
    emitImage: (image) => {
      output.push({ image: { ...image, bytes: [...image.bytes] } })
    }
  }
  return {
    computer,
    host,
    calls,
    output,
    setMeta: (value: unknown) => {
      meta = value
    }
  }
}
async function exercise(reference: boolean) {
  const f = fixture()
  const session = reference
    ? await originalComputerSession(f.computer, f.host)
    : await createComputerSession({ computer: f.computer, getHost: () => f.host })
  await session.listApps()
  await session.getState({ emit: false })
  const app = await session.getApp('TextEdit')
  await app.getAXState({ disableDiffing: true })
  await app.getScreenshot({ emit: false })
  await app.getAXStateAndScreenshot()
  await app.click([10, 20], { mouseButton: 'right', clickCount: 2 })
  await app.click(3)
  await app.drag([1, 2], [3, 4])
  await app.paste('paste')
  await app.paste('rich', { format: 'html' })
  await app.pressKey('CMD+A')
  await app.scroll(3, 'down', 2)
  await app.selectText(3, 'text', { prefix: 'p', suffix: 's', selectionType: 'all' })
  await app.setValue(3, 'value')
  await app.typeText('typed')
  await app.performSecondaryAction(3, 'open')
  return f
}
test('Mac session observations and every app action match original calls and output', async () => {
  const saved = Reflect.get(globalThis, 'nodeRepl')
  try {
    const ref = await exercise(true)
    const own = await exercise(false)
    expect(own.calls).toEqual(ref.calls)
    expect(own.output).toEqual(ref.output)
  } finally {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', saved)
  }
})
test('session binds the host writer from one accessor read per queued emission', async () => {
  const saved = Reflect.get(globalThis, 'nodeRepl')
  async function run(reference: boolean) {
    const f = fixture()
    const writes: string[] = []
    let reads = 0
    Object.defineProperty(f.host, 'write', {
      get() {
        const generation = ++reads
        return (_text: string, id: string) => writes.push(`${generation}:${id}`)
      }
    })
    const session = reference
      ? await originalComputerSession(f.computer, f.host)
      : await createComputerSession({ computer: f.computer, getHost: () => f.host })
    await session.listApps()
    return { writes, reads }
  }
  try {
    expect(await run(false)).toEqual(await run(true))
  } finally {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', saved)
  }
})
test('missing screenshot yields state only and standalone screenshot fails', async () => {
  const f = fixture(null)
  const session = await createComputerSession({ computer: f.computer, getHost: () => f.host })
  const app = await session.getApp('TextEdit')
  expect(await app.getAXStateAndScreenshot({ emit: false })).toEqual({ state: 'state' })
  await expect(app.getScreenshot()).rejects.toThrow('Screenshot unavailable for canonical.app.')
})
test('Mac references and pixel scrolling are rejected without dispatch', async () => {
  const f = fixture()
  const session = await createComputerSession({ computer: f.computer, getHost: () => f.host })
  await expect(session.getApp({ windowId: 1 } as never)).rejects.toThrow('macOS getApp requires')
  const app = await session.getApp('TextEdit')
  expect(() => app.scroll(1, 'down', { pixels: 10 } as never)).toThrow(
    'macOS scroll accepts pages, not pixels.'
  )
  expect(f.calls.filter((c) => c.method === 'scroll')).toEqual([])
})
test('documentation rewrite deduplicates by request metadata identity', async () => {
  const f = fixture()
  const session = await createComputerSession({ computer: f.computer, getHost: () => f.host })
  expect(f.output).toHaveLength(1)
  await session.rewriteDocumentation()
  expect(f.output).toHaveLength(1)
  f.setMeta({})
  await session.rewriteDocumentation()
  expect(f.output).toHaveLength(2)
  await session.rewriteDocumentation()
  expect(f.output).toHaveLength(2)
})
test('read-only factories reject non-Mac backend before calling it', async () => {
  const f = fixture()
  await expect(
    createComputerSession({
      computer: { ...f.computer, target: 'linux' } as never,
      getHost: () => f.host
    })
  ).rejects.toThrow('macOS')
  expect(f.calls).toEqual([])
})
test('rewrite retains initialized documentation when environment changes', async () => {
  const f = fixture()
  const session = await createComputerSession({ computer: f.computer, getHost: () => f.host })
  const first = f.output[0]
  f.host.env!.TINYSKY_ALT_INITIALIZE_DOCS = 'core-cua-repl'
  f.setMeta({})
  await session.rewriteDocumentation()
  expect(f.output[1]).toEqual(first)
})
test('failed initial writer retries core documentation and recovers the queue', async () => {
  const f = fixture()
  let active: SessionHost | undefined
  const session = await createComputerSession({ computer: f.computer, getHost: () => active })
  let fail = true
  active = {
    ...f.host,
    write: (text, id) => {
      if (fail) {
        fail = false
        throw new Error('writer failed')
      }
      f.output.push({ text, id })
    }
  }
  await expect(session.listApps()).rejects.toThrow('writer failed')
  await session.listApps()
  expect(f.output.map((o) => (o as { id: string }).id)).toEqual(['cua.core', 'cua.state'])
})
test('emit false suppresses output but preserves observation result', async () => {
  const f = fixture()
  const session = await createComputerSession({ computer: f.computer, getHost: () => f.host })
  const app = await session.getApp('TextEdit')
  const count = f.output.length
  expect(await session.listApps({ emit: false })).toEqual([{ id: 'app' }])
  expect(await session.getState({ emit: false })).toEqual({ apps: [{ id: 'app' }], browsers: [] })
  expect(await app.getAXStateAndScreenshot({ emit: false })).toEqual({
    state: 'state',
    screenshot: new Uint8Array([1, 2, 3])
  })
  expect(f.output).toHaveLength(count)
})
test('null metadata emits cached documentation on every rewrite', async () => {
  const f = fixture()
  f.setMeta(null)
  const session = await createComputerSession({ computer: f.computer, getHost: () => f.host })
  await session.rewriteDocumentation()
  await session.rewriteDocumentation()
  expect(f.output).toHaveLength(3)
})
test.each(['listApps', 'getState'] as const)(
  'late host receives core docs even when %s state emission is disabled',
  async (method) => {
    const f = fixture()
    let host: SessionHost | undefined
    const session = await createComputerSession({ computer: f.computer, getHost: () => host })
    host = f.host
    await session[method]({ emit: false })
    expect(f.output.map((o) => (o as { id: string }).id)).toEqual(['cua.core'])
  }
)
