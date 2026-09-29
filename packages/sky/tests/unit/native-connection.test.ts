// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createNativeTransport } from '../../src/mac/native-connection'
import { decodeMessageFrames, encodeMessageFrame } from '../../src/mac/rpc-codec'
import type { NativePipe } from '../../src/mac/native-pipe'
class Pipe extends EventEmitter implements NativePipe {
  ended = false
  writes: any[] = []
  constructor(private reply: (m: any) => unknown) {
    super()
  }
  write(data: Uint8Array) {
    const m = JSON.parse(decodeMessageFrames(Buffer.from(data)).messages[0]!)
    this.writes.push(m)
    queueMicrotask(() => this.emit('data', encodeMessageFrame(JSON.stringify(this.reply(m)))))
  }
  end() {
    this.ended = true
    this.emit('close')
  }
}
const ping = (m: any) => ({ id: m.id, jsonrpc: '2.0', result: { serverApiVersion: 'v' } })
afterEach(() => {
  vi.useRealTimers()
})
test('existing pipe pings correct version with trimmed custom path', async () => {
  const pipe = new Pipe(ping)
  const connect = vi.fn(async () => pipe)
  const transport = await createNativeTransport('v', {
    env: { SKY_CUA_SERVICE_NATIVE_PIPE_PATH: ' /custom.sock ' },
    nativePipe: { createConnection: connect }
  })
  expect(connect).toHaveBeenCalledWith('/custom.sock')
  expect(pipe.writes).toEqual([
    { id: 1, jsonrpc: '2.0', method: 'ping', params: { clientApiVersion: 'v' } }
  ])
  expect(transport.isClosed).toBe(false)
  transport.close()
})
test('version mismatch is fatal without startup request and closes pipe', async () => {
  const pipe = new Pipe((m) => ({
    id: m.id,
    jsonrpc: '2.0',
    result: { serverApiVersion: 'wrong' }
  }))
  const launch = vi.fn()
  await expect(
    createNativeTransport('v', {
      nativePipe: { createConnection: async () => pipe },
      launchServices: { openApplication: launch }
    })
  ).rejects.toThrow('API version mismatch')
  expect(pipe.ended).toBe(true)
  expect(launch).not.toHaveBeenCalled()
})
test('missing native support reports explicit transport failure', async () => {
  await expect(createNativeTransport('v', {})).rejects.toThrow('native pipe is unavailable')
})
test('unavailable service uses host ensureService then reconnects and closes ensure pipe', async () => {
  vi.useFakeTimers()
  let ready = false
  const service = new Pipe(ping)
  const hostPipe = new Pipe((m) => {
    ready = true
    return { id: m.id, jsonrpc: '2.0', result: null }
  })
  const connect = vi.fn(async (path: string) => {
    if (path === '/host') return hostPipe
    if (ready) return service
    throw new Error('not running')
  })
  const result = createNativeTransport('v', {
    env: { NODE_REPL_HOST_SERVICES_PIPE_PATH: ' /host ' },
    nativePipe: { createConnection: connect }
  })
  await vi.advanceTimersByTimeAsync(400)
  const transport = await result
  expect(hostPipe.writes).toEqual([
    { id: 0, jsonrpc: '2.0', method: 'ensureService', params: { service: 'computer-use' } }
  ])
  expect(hostPipe.ended).toBe(true)
  transport.close()
})
test('fallback startup uses explicit application path and wraps launch failures', async () => {
  vi.useFakeTimers()
  let ready = false
  const pipe = new Pipe(ping)
  const launch = vi.fn(async () => {
    ready = true
  })
  const result = createNativeTransport('v', {
    env: { SKY_CUA_SERVICE_PATH: ' /Computer Use.app ' },
    nativePipe: {
      createConnection: async () => {
        if (!ready) throw new Error('missing')
        return pipe
      }
    },
    launchServices: { openApplication: launch }
  })
  await vi.advanceTimersByTimeAsync(400)
  const transport = await result
  expect(launch).toHaveBeenCalledWith({ applicationPath: '/Computer Use.app' })
  transport.close()
  const failed = createNativeTransport('v', {
    nativePipe: {
      createConnection: async () => {
        throw new Error('missing')
      }
    },
    launchServices: {
      openApplication: async () => {
        throw new Error('denied')
      }
    }
  })
  const observed = expect(failed).rejects.toMatchObject({
    message: 'Sky Computer Use service startup request failed',
    cause: { message: 'denied' }
  })
  await vi.advanceTimersByTimeAsync(400)
  await observed
})
test('late connection after deadline is ended and never leaked', async () => {
  vi.useFakeTimers()
  const late = new Pipe(ping)
  let resolveConnection!: (pipe: NativePipe) => void
  const result = createNativeTransport('v', {
    nativePipe: {
      createConnection: () =>
        new Promise((resolve) => {
          resolveConnection = resolve
        })
    }
  })
  const observed = expect(result).rejects.toThrow('service startup request failed')
  await vi.advanceTimersByTimeAsync(400)
  await observed
  resolveConnection(late)
  await Promise.resolve()
  expect(late.ended).toBe(true)
})
test('startup ensure request and reconnect call sequence matches original', async () => {
  const { originalModule } = await import('../../../cua/tests/original-module')
  const { resolve } = await import('node:path')
  const ref = await originalModule(
    resolve(
      'packages/back/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/mac/native-pipe.js'
    )
  )
  vi.useFakeTimers()
  const saved = Reflect.get(globalThis, 'nodeRepl')
  async function exercise(original: boolean) {
    vi.setSystemTime(1000)
    let ready = false
    const traces: unknown[] = []
    const service = new Pipe((m) => {
      traces.push(m)
      return ping(m)
    })
    const control = new Pipe((m) => {
      traces.push(m)
      ready = true
      return { id: 0, result: null }
    })
    const host = {
      env: {
        SKY_CUA_SERVICE_NATIVE_PIPE_PATH: '/service',
        NODE_REPL_HOST_SERVICES_PIPE_PATH: '/host'
      },
      nativePipe: {
        createConnection: async (path: string) => {
          traces.push(path)
          if (path === '/host') return control
          if (ready) return service
          throw new Error('not running')
        }
      }
    }
    Reflect.set(globalThis, 'nodeRepl', host)
    const result = original
      ? (ref.MacNativePipeTransport as any).create('v')
      : createNativeTransport('v', host)
    await vi.advanceTimersByTimeAsync(400)
    await result
    service.end()
    return traces
  }
  try {
    expect(await exercise(false)).toEqual(await exercise(true))
  } finally {
    if (saved === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', saved)
  }
})
test('incompatible client version is fatal without launching', async () => {
  const pipe = new Pipe((m) => ({
    id: m.id,
    jsonrpc: '2.0',
    error: { code: -10013, message: 'upgrade required' }
  }))
  const launch = vi.fn()
  await expect(
    createNativeTransport('v', {
      nativePipe: { createConnection: async () => pipe },
      launchServices: { openApplication: launch }
    })
  ).rejects.toMatchObject({ code: -10013 })
  expect(pipe.ended).toBe(true)
  expect(launch).not.toHaveBeenCalled()
})
test('failed startup reconnect wraps cause after deadline', async () => {
  vi.useFakeTimers()
  const result = createNativeTransport('v', {
    nativePipe: {
      createConnection: async () => {
        throw new Error('missing')
      }
    },
    launchServices: { openApplication: async () => {} }
  })
  const observed = expect(result).rejects.toMatchObject({
    message: 'Sky Computer Use native pipe startup failed',
    cause: { message: expect.stringContaining('missing') }
  })
  await vi.advanceTimersByTimeAsync(5500)
  await observed
})
