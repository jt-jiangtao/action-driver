// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkyService, loadMacOptions } from '../../src/service'
import { createSkyProxy } from '../../src/sky-proxy'
test('service initializes once, exposes own methods and rejects accessor execution', async () => {
  const getter = vi.fn()
  const computer = Object.assign(
    Object.create({
      inherited: () => {
        throw new Error('inherited')
      }
    }),
    {
      target: 'mac',
      list_apps: async () => [{ id: 'app' }],
      stop_audio_recording: async () => ({
        filepath: '/audio',
        data_url: 'data:audio/wav;base64,AQID',
        bytes: new Uint8Array([1, 2, 3])
      })
    }
  )
  Object.defineProperty(computer, 'getter', { get: getter })
  const factory = vi.fn(() => computer)
  const service = createSkyService(factory)
  expect(await service({ type: 'setup' })).toEqual({
    target: 'mac',
    methods: ['list_apps', 'stop_audio_recording']
  })
  expect(await service({ type: 'execute', method: 'list_apps', args: [] })).toEqual([{ id: 'app' }])
  expect(await service({ type: 'execute', method: 'stop_audio_recording', args: [] })).toEqual({
    filepath: '/audio',
    data_url: 'data:audio/wav;base64,AQID'
  })
  for (const method of ['inherited', 'getter', 'missing'])
    await expect(service({ type: 'execute', method, args: [] })).rejects.toThrow(
      'Sky runtime method is not available'
    )
  expect(getter).not.toHaveBeenCalled()
  expect(factory).toHaveBeenCalledTimes(1)
  await expect(
    service({ type: 'drag_start', handle_id: 'x', point: { x: 1, y: 2 } } as never)
  ).rejects.toThrow('Linux runtime')
})
test('proxy binds remote methods, rebuilds audio bytes and forwards arguments', async () => {
  const calls: unknown[] = []
  const host = {
    rpc: async (service: string, message: any) => {
      calls.push({ service, message })
      if (message.type === 'setup')
        return { target: 'mac', methods: ['list_apps', 'stop_audio_recording'] }
      if (message.method === 'list_apps') return [{ id: message.args[0] }]
      return { filepath: '/audio', data_url: 'data:audio/wav;base64,AQID' }
    }
  }
  const sky = await createSkyProxy({ host })
  expect(sky.target).toBe('mac')
  expect(Object.keys(sky)).toEqual(['target', 'list_apps', 'stop_audio_recording'])
  expect(await sky.list_apps!('app')).toEqual([{ id: 'app' }])
  expect(await sky.stop_audio_recording!()).toEqual({
    filepath: '/audio',
    data_url: 'data:audio/wav;base64,AQID',
    bytes: new Uint8Array([1, 2, 3])
  })
  expect(calls).toEqual([
    { service: 'sky', message: { type: 'setup' } },
    { service: 'sky', message: { type: 'execute', method: 'list_apps', args: ['app'] } },
    { service: 'sky', message: { type: 'execute', method: 'stop_audio_recording', args: [] } }
  ])
})
test('failed proxy setup retains failure for unknown calls and local fallback is lazy', async () => {
  const error = new Error('setup failed')
  const sky = await createSkyProxy({
    host: {
      rpc: async () => {
        throw error
      }
    }
  })
  await expect(sky.list_apps!()).rejects.toBe(error)
  const local = vi.fn(() => ({ target: 'mac', list_apps: async () => ['local'] }))
  const fallback = await createSkyProxy({ createLocal: local })
  expect(local).not.toHaveBeenCalled()
  expect(await fallback.list_apps!()).toEqual(['local'])
  expect(local).toHaveBeenCalledTimes(1)
  const bad = await createSkyProxy({ host: {} })
  expect(() => bad.target).toThrow('configure NODE_REPL_TRUSTED_SERVICES')
})
test('macOS config reads original environment key and rejects other platforms/targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-config-'))
  try {
    const path = join(root, 'config.json')
    await writeFile(path, JSON.stringify({ target: 'mac', extra: 1 }))
    expect(loadMacOptions({ OAI_SKY_CONFIG_PATH: ` ${path} ` }, 'darwin')).toEqual({
      target: 'mac',
      extra: 1
    })
    expect(loadMacOptions({}, 'darwin')).toEqual({ target: 'mac' })
    expect(() => loadMacOptions({}, 'linux')).toThrow('macOS')
    await writeFile(path, JSON.stringify({ target: 'windows' }))
    expect(() => loadMacOptions({ OAI_SKY_CONFIG_PATH: path }, 'darwin')).toThrow('macOS')
    await writeFile(path, '{')
    expect(() => loadMacOptions({ OAI_SKY_CONFIG_PATH: path }, 'darwin')).toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('Mac service RPC outputs match baseline for setup, actions and audio serialization', async () => {
  const { originalMacModule } = await import('../original-mac-module')
  const computer = {
    target: 'mac',
    list_apps: async () => [{ id: 'app' }],
    click: async (input: unknown) => input,
    stop_audio_recording: async () => ({
      filepath: '/audio',
      bytes: new Uint8Array([1, 2]),
      data_url: 'data:audio/wav;base64,AQI='
    })
  }
  const key = Symbol.for('cua-reference-computer')
  Reflect.set(globalThis, key, computer)
  try {
    const ref = await originalMacModule('../../service.js'),
      own = createSkyService(() => computer)
    for (const message of [
      { type: 'setup' },
      { type: 'execute', method: 'list_apps', args: [] },
      { type: 'execute', method: 'click', args: [{ app: 'app', x: 1 }] },
      { type: 'execute', method: 'stop_audio_recording', args: [] }
    ])
      expect(await own(message as never)).toEqual(await ref.handleRpc(message))
  } finally {
    Reflect.deleteProperty(globalThis, key)
  }
})
test('Mac remote proxy matches baseline keys, RPC traces and decoded audio', async () => {
  const { originalMacModule } = await import('../original-mac-module')
  const saved = Reflect.get(globalThis, 'nodeRepl')
  async function exercise(reference: boolean) {
    const calls: unknown[] = []
    const host = {
      rpc: async (service: string, message: any) => {
        calls.push({ service, message })
        if (message.type === 'setup')
          return { target: 'mac', methods: ['list_apps', 'stop_audio_recording'] }
        return message.method === 'list_apps'
          ? [{ id: 'app' }]
          : { filepath: '/audio', data_url: 'data:audio/wav;base64,AQI=' }
      }
    }
    Reflect.set(globalThis, 'nodeRepl', host)
    const sky = reference
      ? (await originalMacModule('../../sky.js')).sky
      : await createSkyProxy({ host })
    const result = {
      keys: Object.keys(sky),
      target: sky.target,
      apps: await sky.list_apps(),
      audio: await sky.stop_audio_recording(),
      calls
    }
    return result
  }
  try {
    expect(await exercise(false)).toEqual(await exercise(true))
  } finally {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', saved)
  }
})
test('default sky entry fails closed without an explicit ActionDriver host', async () => {
  const saved = Reflect.get(globalThis, 'nodeRepl')
  const rpc = vi.fn(async (_service: string, message: any) =>
    message.type === 'setup' ? { target: 'mac', methods: ['list_apps'] } : [{ id: 'app' }]
  )
  Reflect.set(globalThis, 'nodeRepl', { rpc })
  try {
    const module = await import('../../src/sky')
    expect(() => module.sky.target).toThrow('SKY_HOST_UNAVAILABLE')
    expect(rpc).not.toHaveBeenCalled()
  } finally {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', saved)
  }
})
