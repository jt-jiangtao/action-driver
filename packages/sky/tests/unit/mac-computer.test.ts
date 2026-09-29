// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createMacComputer } from '../../src/mac/computer'
import { createComputerSession } from '../../../cua/src/computer-session'
import { originalMacModule } from '../original-mac-module'
const saved = Reflect.get(globalThis, 'nodeRepl')
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
  else Reflect.set(globalThis, 'nodeRepl', saved)
  Reflect.deleteProperty(globalThis, Symbol.for('cua-reference-client'))
  Reflect.deleteProperty(globalThis, Symbol.for('cua-reference-telemetry'))
})
function fixture(audioUrl = 'file:///missing.wav') {
  const trace: unknown[] = []
  const action = (method: string) => async (input: unknown) => {
    trace.push({ method, input })
  }
  const client = {
    getAppPolicy: async (app: string) => {
      trace.push({ policy: app })
      return {
        decision: 'allowed',
        allowPersistentApproval: false,
        target: { appPath: '/App.app', bundleIdentifier: 'app.id', displayName: 'App', risk: 'low' }
      }
    },
    listApps: async () => [
      {
        bundleIdentifier: 'app.id',
        displayName: 'App',
        isRunning: true,
        lastUsedDate: null,
        useCount: null
      },
      { displayName: 'No bundle' },
      { appPath: '/No identity' }
    ],
    getAppState: async (input: unknown) => {
      trace.push({ method: 'getAppState', input })
      return {
        app: { bundleIdentifier: 'app.id' },
        skyshot: { text: 'state', screenshot: { url: 'data:image/png;base64,AQID' } },
        appSpecificInstructions: 'instructions'
      }
    },
    click: action('click'),
    drag: action('drag'),
    paste: action('paste'),
    pressKey: action('pressKey'),
    scroll: action('scroll'),
    selectText: action('selectText'),
    setValue: action('setValue'),
    typeText: action('typeText'),
    performSecondaryAction: action('performSecondaryAction'),
    startAudioRecording: action('startAudioRecording'),
    stopAudioRecording: async () => ({ url: audioUrl })
  }
  const telemetry = {
    clientCreated: () => trace.push('created'),
    toolCalled: (e: unknown) => trace.push({ tool: e }),
    approvalRequested: (e: unknown) => trace.push({ requested: e }),
    approvalResolved: (e: unknown) => trace.push({ resolved: e })
  }
  const host = {
    setResponseMeta: (e: unknown) => trace.push({ response: e }),
    createElicitation: async (e: unknown) => {
      trace.push({ approval: e })
      return { action: 'accept' }
    },
    withSuspendedTimeout: async <T>(fn: () => Promise<T>) => {
      trace.push('suspended')
      return fn()
    },
    write: () => {},
    env: { TINYSKY_ALT_INITIALIZE_DOCS: 'core-node-repl' }
  }
  return { client, telemetry, host, trace }
}
async function make(reference: boolean, f: ReturnType<typeof fixture>, audio = false) {
  if (reference) {
    Reflect.set(globalThis, 'nodeRepl', f.host)
    Reflect.set(globalThis, Symbol.for('cua-reference-client'), f.client)
    Reflect.set(globalThis, Symbol.for('cua-reference-telemetry'), f.telemetry)
    const module = await originalMacModule('create_client.js')
    return module.create_client({})
  }
  return createMacComputer({
    getClient: async () => f.client as never,
    getHost: () => f.host,
    telemetry: f.telemetry,
    enableAudio: audio
  })
}
test('all facade observations/actions and per-client instructions match original', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  vi.spyOn(performance, 'now').mockReturnValue(10)
  async function exercise(reference: boolean) {
    const f = fixture(),
      computer = await make(reference, f)
    const apps = await computer.list_apps()
    const first = await computer.get_app_state({ app: 'App', disableDiff: true }),
      second = await computer.get_app_state({ app: 'App' })
    await computer.click({ app: 'App', element_index: 1, mouse_button: 'right', click_count: 2 })
    await computer.drag({ app: 'App', from_x: 1, from_y: 2, to_x: 3, to_y: 4 })
    await computer.paste({ app: 'App', text: 'text', format: 'html' })
    await computer.press_key({ app: 'App', key: 'CMD+A' })
    await computer.scroll({ app: 'App', x: 1, y: 2, direction: 'down', pages: 2 })
    await computer.select_text({
      app: 'App',
      element_index: 1,
      text: 'text',
      prefix: 'p',
      selection_type: 'all'
    })
    await computer.set_value({ app: 'App', element_index: 1, value: 'value' })
    await computer.type_text({ app: 'App', text: 'typed' })
    await computer.perform_secondary_action({ app: 'App', element_index: 1, action: 'open' })
    return { apps, first, second, trace: f.trace }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})
test('facade integrates with own CUA session using approved canonical path', async () => {
  const f = fixture()
  const computer = await make(false, f)
  const session = await createComputerSession({ computer, getHost: () => f.host })
  const app = await session.getApp('App')
  await app.click(3)
  expect(f.trace).toContainEqual({
    method: 'click',
    input: expect.objectContaining({ app: '/App.app', elementIndex: 3 })
  })
  expect(await app.getScreenshot({ emit: false })).toEqual(new Uint8Array([1, 2, 3]))
})
test('audio flag gates methods and validates duration before approval', async () => {
  const f = fixture()
  expect(await make(false, f)).not.toHaveProperty('start_audio_recording')
  const computer = await make(false, f, true)
  for (const duration of [99, 300001, 1.5, Infinity])
    await expect(computer.start_audio_recording({ max_duration_ms: duration })).rejects.toThrow(
      'duration must be an integer'
    )
  expect(f.trace.filter((x) => typeof x === 'object' && x !== null && 'approval' in x)).toEqual([])
  await computer.start_audio_recording()
  expect(f.trace).toContainEqual({
    method: 'startAudioRecording',
    input: { maxDurationMilliseconds: 60000 }
  })
})
test('audio response reads local WAV and excludes remote or missing URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cua-audio-'))
  try {
    const path = join(directory, 'audio.wav')
    await writeFile(path, new Uint8Array([0, 1, 255]))
    const f = fixture(pathToFileURL(path).href),
      computer = await make(false, f, true)
    expect(await computer.stop_audio_recording()).toEqual({
      filepath: path,
      bytes: new Uint8Array([0, 1, 255]),
      data_url: 'data:audio/wav;base64,AAH/'
    })
    for (const url of ['https://host/audio.wav', '', undefined]) {
      const f = fixture()
      f.client.stopAudioRecording = async () => ({ url }) as never
      await expect((await make(false, f, true)).stop_audio_recording()).rejects.toThrow(
        'computer audio URL'
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
test('audio approval and local output match original audio functions', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(10)
  const directory = await mkdtemp(join(tmpdir(), 'cua-audio-ref-'))
  try {
    const path = join(directory, 'audio.wav')
    await writeFile(path, new Uint8Array([1, 2, 3]))
    async function exercise(reference: boolean) {
      const f = fixture(pathToFileURL(path).href)
      Reflect.set(globalThis, 'nodeRepl', f.host)
      Reflect.set(globalThis, Symbol.for('cua-reference-client'), f.client)
      Reflect.set(globalThis, Symbol.for('cua-reference-telemetry'), f.telemetry)
      const computer = reference
        ? await originalMacModule('audio_recording.js')
        : await make(false, f, true)
      await computer.start_audio_recording({ max_duration_ms: 100 })
      const result = await computer.stop_audio_recording()
      return { result, trace: f.trace.filter((x) => x !== 'created') }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
