// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Json, PlacementDeclaration } from '@actiondriver/plugin-contracts'
import { HostRegistry, type PlacementAuditEntry, type PlacementError } from '../../../src/placement/hosts'
import { PlacementInvoker, type HostChannel } from '../../../src/placement/invoker'
import { selectHost } from '../../../src/placement/selector'

const localHost = (overrides: Record<string, unknown> = {}) => ({
  protocol: 1,
  hostId: 'desktop-1',
  instanceId: 'instance-1',
  kind: 'local-workspace',
  target: 'local',
  devices: ['display', 'input', 'filesystem', 'network'],
  workspace: 'session-workspace',
  tools: ['tools/local/web/open'],
  plugins: [{ id: 'web', version: '1.0.0' }],
  ...overrides
})

const cloudHost = (overrides: Record<string, unknown> = {}) => ({
  protocol: 1,
  hostId: 'cloud-1',
  instanceId: 'instance-1',
  kind: 'cloud',
  target: 'cloud',
  devices: ['network'],
  workspace: 'none',
  tools: ['tools/cloud/analyze'],
  plugins: [{ id: 'analysis', version: '1.0.0' }],
  ...overrides
})

function registry(audit?: (entry: PlacementAuditEntry) => void) {
  let clock = 1_000
  return new HostRegistry({ now: () => (clock += 1), ...(audit ? { audit } : {}) })
}

const declaration = (value: Partial<PlacementDeclaration> & Pick<PlacementDeclaration, 'locations'>): PlacementDeclaration => ({
  workspace: 'none',
  protocol: 1,
  ...value
})

describe('host handshake and directory', () => {
  it('rejects an unsupported protocol and accepts a matching handshake', () => {
    const hosts = registry()
    expect(() => hosts.connect(localHost({ protocol: 7 }))).toThrow(/PLACEMENT_PROTOCOL_UNSUPPORTED/)
    expect(hosts.connect(localHost()).instanceId).toBe('instance-1')
    expect(hosts.list()).toHaveLength(1)
  })

  it('supersedes the old instance on reconnect and rejects its late messages', () => {
    const audit: PlacementAuditEntry[] = []
    const hosts = registry(entry => audit.push(entry))
    hosts.connect(localHost())
    hosts.connect(localHost({ instanceId: 'instance-2' }))
    expect(hosts.assertCurrent('desktop-1', 'instance-2').instanceId).toBe('instance-2')
    const stale = (() => {
      try {
        hosts.assertCurrent('desktop-1', 'instance-1')
        return null
      } catch (error) {
        return error as PlacementError
      }
    })()
    expect(stale?.code).toBe('PLACEMENT_STALE_INSTANCE')
    expect(hosts.isSuperseded('desktop-1', 'instance-1')).toBe(true)
    expect(audit.map(entry => entry.kind)).toEqual(['host.connected', 'host.superseded', 'host.connected'])
  })

  it('withdraws the host entry point on disconnect', () => {
    const hosts = registry()
    hosts.connect(localHost())
    hosts.disconnect('desktop-1', 'instance-1')
    expect(hosts.list()).toEqual([])
    expect(() => hosts.assertCurrent('desktop-1', 'instance-1')).toThrow(/PLACEMENT_STALE_INSTANCE/)
  })
})

describe('placement selection', () => {
  const options = { now: () => 2_000 }

  it('fails explicitly when the required device is missing instead of substituting another location', () => {
    const hosts = registry()
    hosts.connect(localHost({ devices: ['network'] }))
    const failure = (() => {
      try {
        selectHost(hosts, {
          plugin: { id: 'web', version: '1.0.0' },
          declaration: declaration({ locations: ['local-workspace'], devices: ['display'] }),
          toolId: 'tools/local/web/open',
          grants: ['tools/local/web/open@1']
        }, options)
        return null
      } catch (error) {
        return error as PlacementError
      }
    })()
    expect(failure?.code).toBe('PLACEMENT_DEVICE_MISSING')
    expect(failure?.message).toContain('display')
  })

  it('selects the preferred host among compatible locations and records the decision', () => {
    const audit: PlacementAuditEntry[] = []
    const hosts = registry(entry => audit.push(entry))
    hosts.connect(localHost({ kind: 'ui', hostId: 'ui-1' }))
    hosts.connect(localHost({ kind: 'local-workspace', hostId: 'desktop-1' }))
    const decision = selectHost(hosts, {
      plugin: { id: 'web', version: '1.0.0' },
      declaration: declaration({ locations: ['ui', 'local-workspace'], preferred: 'ui' }),
      toolId: 'tools/local/web/open',
      grants: ['tools/local/web/open@1']
    }, { now: () => 2_000, audit: entry => audit.push(entry) })
    expect(decision.host.hostId).toBe('ui-1')
    expect(decision.location).toBe('ui')
    expect(audit.at(-1)).toMatchObject({ kind: 'placement.selected', hostId: 'ui-1', location: 'ui', pluginId: 'web' })
  })

  it('does not reuse a local grant for the cloud tool of the same name', () => {
    const hosts = registry()
    hosts.connect(localHost({ tools: ['tools/local/analyze'] }))
    hosts.connect(cloudHost({ tools: ['tools/cloud/analyze'] }))
    const forged = (() => {
      try {
        // The caller passes a cloud tool id but only holds the local grant.
        selectHost(hosts, {
          plugin: { id: 'analysis', version: '1.0.0' },
          toolId: 'tools/cloud/analyze',
          grants: ['tools/local/analyze@1']
        }, options)
        return null
      } catch (error) {
        return error as PlacementError
      }
    })()
    expect(forged?.code).toBe('PLACEMENT_TARGET_MISMATCH')

    const granted = selectHost(hosts, {
      plugin: { id: 'analysis', version: '1.0.0' },
      toolId: 'tools/cloud/analyze',
      grants: ['tools/cloud/analyze@1']
    }, options)
    expect(granted.location).toBe('cloud')
  })

  it('refuses a location the plugin does not declare even when a host is online', () => {
    const hosts = registry()
    hosts.connect(cloudHost())
    const failure = (() => {
      try {
        selectHost(hosts, {
          plugin: { id: 'analysis', version: '1.0.0' },
          declaration: declaration({ locations: ['local-workspace'] }),
          toolId: 'tools/cloud/analyze',
          grants: ['tools/cloud/analyze@1']
        }, options)
        return null
      } catch (error) {
        return error as PlacementError
      }
    })()
    expect(failure?.code).toBe('PLACEMENT_NO_HOST')
  })
})

describe('cross-host invocation', () => {
  function harness(channel: HostChannel | null, options: { disconnectAfter?: boolean } = {}) {
    const hosts = registry()
    hosts.connect(localHost())
    const invoker = new PlacementInvoker({
      registry: hosts,
      channel: () => channel,
      now: () => 2_000
    })
    const call = {
      requestId: 'request-1',
      callId: 'call-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      deadline: 60_000,
      signal: new AbortController().signal
    }
    const request = {
      plugin: { id: 'web', version: '1.0.0' },
      toolId: 'tools/local/web/open',
      grants: ['tools/local/web/open@1'] as const
    }
    if (options.disconnectAfter) hosts.disconnect('desktop-1', 'instance-1')
    return { hosts, invoker, call, request }
  }

  it('pins host, instance and plugin version and passes only the minimal context', async () => {
    const invoke = vi.fn(async (input: unknown) => { void input; return 'ok' as Json })
    const { invoker, call, request } = harness({ invoke })
    await expect(invoker.invoke({ ...request, grants: [...request.grants] }, { url: 'https://example.com' }, call)).resolves.toBe('ok')
    expect(invoke).toHaveBeenCalledOnce()
    const sent = invoke.mock.calls[0]![0] as unknown as { owner: { hostEpoch: string }; context: Record<string, unknown> }
    expect(sent.owner.hostEpoch).toBe('desktop-1:instance-1')
    expect(Object.keys(sent.context).sort()).toEqual(['callId', 'deadline', 'grants', 'requestId', 'sessionId', 'taskId'])
  })

  it('reports an unknown outcome when the host disconnects mid-call and never replays elsewhere', async () => {
    const hosts = registry()
    hosts.connect(localHost())
    const invoke = vi.fn(async () => {
      hosts.disconnect('desktop-1', 'instance-1')
      throw Object.assign(new Error('socket closed'), { code: 'DISCONNECTED' })
    })
    const invoker = new PlacementInvoker({ registry: hosts, channel: () => ({ invoke }), now: () => 2_000 })
    const failure = await invoker.invoke(
      { plugin: { id: 'web', version: '1.0.0' }, toolId: 'tools/local/web/open', grants: ['tools/local/web/open@1'] },
      null,
      { requestId: 'r', callId: 'c', deadline: 60_000, signal: new AbortController().signal }
    ).then(() => null, (error: PlacementError) => error)
    expect(failure?.code).toBe('PLACEMENT_RESULT_UNKNOWN')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('sends cancellation to the pinned instance and reports unknown until the host confirms', async () => {
    const cancel = vi.fn(async () => {})
    const controller = new AbortController()
    const invoke = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      controller.abort()
      await new Promise(resolve => setTimeout(resolve, 0))
      if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
      return 'late' as Json
    })
    const hosts = registry()
    hosts.connect(localHost())
    const invoker = new PlacementInvoker({ registry: hosts, channel: () => ({ invoke, cancel }), now: () => 2_000 })
    const failure = await invoker.invoke(
      { plugin: { id: 'web', version: '1.0.0' }, toolId: 'tools/local/web/open', grants: ['tools/local/web/open@1'] },
      null,
      { requestId: 'r', callId: 'c', deadline: 60_000, signal: controller.signal }
    ).then(() => null, (error: PlacementError) => error)
    expect(cancel).toHaveBeenCalledOnce()
    expect(failure?.code).toBe('PLACEMENT_RESULT_UNKNOWN')
  })

  it('attributes a live host error to that host instead of marking the outcome unknown', async () => {
    const hosts = registry()
    hosts.connect(localHost())
    const invoke = vi.fn(async () => { throw new Error('tool failed remotely') })
    const invoker = new PlacementInvoker({ registry: hosts, channel: () => ({ invoke }), now: () => 2_000 })
    await expect(invoker.invoke(
      { plugin: { id: 'web', version: '1.0.0' }, toolId: 'tools/local/web/open', grants: ['tools/local/web/open@1'] },
      null,
      { requestId: 'r', callId: 'c', deadline: 60_000, signal: new AbortController().signal }
    )).rejects.toThrow('tool failed remotely')
  })

  it('refuses to start a call when no host is connected', async () => {
    const hosts = registry()
    const invoker = new PlacementInvoker({ registry: hosts, channel: () => null, now: () => 2_000 })
    await expect(invoker.invoke(
      { plugin: { id: 'web', version: '1.0.0' }, toolId: 'tools/local/web/open', grants: ['tools/local/web/open@1'] },
      null,
      { requestId: 'r', callId: 'c', deadline: 60_000, signal: new AbortController().signal }
    )).rejects.toThrow(/PLACEMENT_NO_HOST/)
  })

  it('binds an in-flight call to its original instance and discards a late result after reconnect', async () => {
    const hosts = registry()
    hosts.connect(localHost())
    const invoke = vi.fn(async () => {
      // The host reconnects with a new instance while the old call is still in flight.
      hosts.connect(localHost({ instanceId: 'instance-2', plugins: [{ id: 'web', version: '2.0.0' }] }))
      return 'late result from instance-1' as Json
    })
    const invoker = new PlacementInvoker({ registry: hosts, channel: () => ({ invoke }), now: () => 2_000 })
    const failure = await invoker.invoke(
      { plugin: { id: 'web', version: '1.0.0' }, toolId: 'tools/local/web/open', grants: ['tools/local/web/open@1'] },
      null,
      { requestId: 'r', callId: 'c', deadline: 60_000, signal: new AbortController().signal }
    ).then(() => null, (error: PlacementError) => error)
    expect(failure?.code).toBe('PLACEMENT_STALE_INSTANCE')
    expect(hosts.get('desktop-1')?.instanceId).toBe('instance-2')
  })

  it('bounds the call with its deadline and reports an unconfirmed outcome', async () => {
    const hosts = registry()
    hosts.connect(localHost())
    const invoke = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }) })
      throw new Error('aborted')
    })
    const invoker = new PlacementInvoker({ registry: hosts, channel: () => ({ invoke }), now: () => 2_000 })
    const failure = await invoker.invoke(
      { plugin: { id: 'web', version: '1.0.0' }, toolId: 'tools/local/web/open', grants: ['tools/local/web/open@1'] },
      null,
      { requestId: 'r', callId: 'c', deadline: 2_010, signal: new AbortController().signal }
    ).then(() => null, (error: PlacementError) => error)
    expect(failure?.code).toBe('PLACEMENT_RESULT_UNKNOWN')
    expect(failure?.message).toContain('deadline')
  })
})
