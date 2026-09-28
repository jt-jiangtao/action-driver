// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { createBackendDiscovery, backendPaths } from '../src/service-discovery'
import { originalDocumentation } from './original-service'
import * as profiles from '../src/service-profiles'
import { browserStatsig } from '../src/service-statsig'
async function compare(exercise: (load: any) => Promise<unknown>) {
  const base = await originalDocumentation()
  expect(await exercise((connect: any) => createBackendDiscovery({ connect }))).toEqual(
    await exercise(base.createBaselineDiscovery)
  )
}
function host(env: any = {}) {
  return {
    platform: 'darwin',
    env: { BROWSER_USE_BACKEND_PATHS: '/tmp/a:/tmp/b', BROWSER_USE_TINYSKY_ENABLED: '0', ...env },
    requestMeta: { 'x-codex-turn-metadata': { session_id: 'session', turn_id: 'turn' } }
  }
}
function api(info: any) {
  return {
    closed: 0,
    getInfo: async () => ({ ...info }),
    close: async function () {
      this.closed++
    }
  }
}
const preferences = { isFullCdpEnabled: async () => false, isWebMcpEnabled: async () => true }
test('discovery deduplicates explicit paths, reuses old connections and closes removed pipes', async () => {
  await compare(async (create) => {
    const connected: string[] = [],
      a = api({ type: 'extension' }),
      b = api({ type: 'cdp' }),
      stale = api({ type: 'extension' }),
      load = create(async (path: string) => {
        connected.push(path)
        return path === '/tmp/a' ? a : b
      }),
      previous = [{ id: 'old', pipe: '/tmp/stale', info: { type: 'extension' }, api: stale }]
    const first = await load(
        host({ BROWSER_USE_BACKEND_PATHS: '/tmp/a:/tmp/b:/tmp/a:' }),
        (value: any) => value,
        previous,
        preferences
      ),
      second = await load(
        host({ BROWSER_USE_BACKEND_PATHS: '/tmp/b' }),
        (value: any) => value,
        first,
        preferences
      )
    return {
      first: first.map((item: any) => ({ pipe: item.pipe, info: item.info })),
      second: second.map((item: any) => item.pipe),
      connected,
      closed: [a.closed, b.closed, stale.closed],
      reused: second[0] === first[1]
    }
  })
})
test('discovery enforces session and build-flavor ownership for IAB connections', async () => {
  await compare(async (create) => {
    const apis = [
      api({ type: 'iab', metadata: { codexSessionId: 'session', codexAppBuildFlavor: 'stable' } }),
      api({ type: 'iab', metadata: { codexSessionId: 'other', codexAppBuildFlavor: 'stable' } }),
      api({ type: 'iab', metadata: { codexSessionId: 'session', codexAppBuildFlavor: 'dev' } })
    ]
    let i = 0
    const load = create(async () => apis[i++])
    const result = await load(
      host({
        BROWSER_USE_BACKEND_PATHS: '/tmp/a:/tmp/b:/tmp/c',
        BROWSER_USE_CODEX_APP_BUILD_FLAVOR: 'stable'
      }),
      (value: any) => value,
      [],
      preferences
    )
    return { result: result.map((item: any) => item.pipe), closed: apis.map((item) => item.closed) }
  })
})
test('discovery exact socket and available backend filters close disallowed backends', async () => {
  await compare(async (create) => {
    const connected: any[] = [],
      a = api({ type: 'extension' }),
      load = create(async (path: string) => {
        connected.push(path)
        return a
      })
    const result = await load(
      host({
        CDP_BROWSER_BACKEND_PIPE_PATH: '/tmp/a',
        BROWSER_AUTH_EVAL_EXACT_CDP_BACKEND_SOCKET: 'true',
        BROWSER_USE_AVAILABLE_BACKENDS: 'iab'
      }),
      (value: any) => value,
      [],
      preferences
    )
    return { result, connected, closed: a.closed }
  })
})
test('missing required metadata fails before connecting; listing and connection failures yield empty results', async () => {
  await compare(async (create) => {
    let connected = 0
    const load = create(async () => {
        connected++
        throw Error('connect')
      }),
      errors: string[] = []
    const broken = host()
    broken.requestMeta = {} as any
    try {
      await load(broken, (value: any) => value, [], preferences)
    } catch (e: any) {
      errors.push(e.message)
    }
    const result = await load(host(), (value: any) => value, [], preferences)
    const relative = await load(
      host({ BROWSER_USE_BACKEND_PATHS: 'relative' }),
      (value: any) => value,
      [],
      preferences
    )
    return { connected, errors, result, relative }
  })
})
test('backend paths enforce absolute POSIX inputs and mac-only discovery', async () => {
  expect(await backendPaths(host({ BROWSER_USE_BACKEND_PATHS: '/a::/a:/b' }))).toEqual(['/a', '/b'])
  await expect(backendPaths(host({ BROWSER_USE_BACKEND_PATHS: 'relative' }))).rejects.toThrow(
    'must be absolute'
  )
  await expect(backendPaths({ ...host(), platform: 'linux' })).rejects.toThrow(
    'Unsupported browser backend platform'
  )
})
test('info timeout closes newly connected APIs', async () => {
  vi.useFakeTimers()
  try {
    const connected = api({ type: 'cdp' })
    connected.getInfo = () => new Promise(() => {})
    const load = createBackendDiscovery({ connect: async () => connected as any })
    const result = load(
      host({ BROWSER_USE_BACKEND_PATHS: '/tmp/a' }),
      (value: any) => value,
      [],
      preferences
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toEqual([])
    expect(connected.closed).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})
test('discovery reports connection and info failure phases and missing IAB counts', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const errors: string[] = [],
      events: any[] = []
    const connect = async (path: string) => {
      if (path === '/tmp/a') throw Object.assign(Error('connection failed'), { code: 'ENOENT' })
      return {
        getInfo: async () => {
          throw Error('info failed')
        },
        close: async () => {}
      }
    }
    const load = original
      ? base.createBaselineDiscoveryDiagnostics(
          connect,
          (error: any) => errors.push(error.message),
          (...args: any[]) => events.push(args.slice(1))
        )
      : createBackendDiscovery({
          connect,
          captureException: (error: any) => errors.push(error.message),
          logEvent: (...args: any[]) => events.push(args.slice(1))
        })
    const result = await load(host(), (value: any) => value, [], preferences)
    return { result, errors, events }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})

test('default discovery wires profile enrichment, Statsig AX enablement and host error reporting', async () => {
  const enrich = vi
    .spyOn(profiles, 'enrichProfileInfo')
    .mockImplementation(async (info: any) => ({
      ...info,
      metadata: { ...info.metadata, profileName: 'profile' }
    }))
  const gate = vi.spyOn(browserStatsig, 'checkGate').mockReturnValue(true)
  const errors: any[] = []
  try {
    const backend = api({ type: 'extension' }),
      load = createBackendDiscovery({ connect: async () => backend })
    const runtime = {
      ...host({ BROWSER_USE_BACKEND_PATHS: '/tmp/a' }),
      errorReporter: { captureException: (error: any) => errors.push(error.message) }
    }
    delete runtime.env.BROWSER_USE_TINYSKY_ENABLED
    const first = await load(runtime, (value: any) => value, [], preferences)
    expect(first[0]?.info.metadata?.profileName).toBe('profile')
    expect(first[0]?.info.apiSupportOverrides).toEqual({
      'Tab.ax': true,
      'Tab.cua': false,
      'Tab.dom_cua': false
    })
    enrich.mockRejectedValueOnce(Error('profile unavailable'))
    const second = await load(runtime, (value: any) => value, [], preferences)
    expect(second).toHaveLength(1)
    expect(errors).toEqual(['profile unavailable'])
  } finally {
    enrich.mockRestore()
    gate.mockRestore()
  }
})
test('discovery diagnostics retain pre-filter pipe count and listing errors', async () => {
  const base = await originalDocumentation()
  for (const env of [
    { CDP_BROWSER_BACKEND_PIPE_PATH: '/tmp/a', BROWSER_AUTH_EVAL_EXACT_CDP_BACKEND_SOCKET: 'true' },
    { BROWSER_USE_BACKEND_PATHS: 'relative' }
  ]) {
    async function exercise(original: boolean) {
      const events: any[] = [],
        connect = async () => api({ type: 'cdp' }),
        log = (...args: any[]) => events.push(args.slice(1)),
        load = original
          ? base.createBaselineDiscoveryDiagnostics(connect, () => {}, log)
          : createBackendDiscovery({ connect, logEvent: log })
      await load(host(env), (value: any) => value, [], preferences)
      return events
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
