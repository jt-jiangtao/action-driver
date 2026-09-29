// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Json } from '@actiondriver/plugin-contracts'
import { PlacementRouter, type LocalHostOptions } from '../../../src/placement/router'
import { registerPlacementRoutes } from '../../../src/placement/routes'
import { RuntimeSkillRegistry } from '../../../src/skill-registry'

function skillsFor(binding: { skillId: string }): RuntimeSkillRegistry {
  const skills = new RuntimeSkillRegistry()
  skills.register({
    providerId: `provider-${binding.skillId}`,
    providerVersion: '1.0.0',
    skillId: binding.skillId,
    contractVersion: 1,
    async execute(): Promise<{ ok: true; providerId: string; input: Json }> {
      return { ok: true, providerId: `provider-${binding.skillId}`, input: { redacted: true } }
    }
  })
  return skills
}

function host(overrides: Partial<LocalHostOptions> & Pick<LocalHostOptions, 'hostId' | 'kind' | 'tools' | 'bindings' | 'plugins'>): LocalHostOptions {
  const skills = skillsFor(Object.values(overrides.bindings)[0]!)
  return {
    instanceId: 'instance-1',
    devices: [],
    workspace: 'none',
    resolve: (skillId, contractVersion) => skills.resolve(skillId, contractVersion),
    ...overrides
  }
}

function asFetch(app: Hono): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    app.request(input instanceof Request ? input : new Request(String(input), init))) as unknown as typeof fetch
}

/**
 * Cross-location acceptance drill: what a remote or UI host can reach, what it receives, and what
 * happens when the connection fails. Every boundary is asserted with the real HTTP surface.
 */
describe('cross-location security acceptance', () => {
  function cloudPeer() {
    const peer = new PlacementRouter()
    peer.registerLocalHost(host({
      hostId: 'cloud-1',
      kind: 'cloud',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, peer.routes())
    return { peer, app }
  }

  it('sends only the minimal call context, with no resource URI, credential or workspace path', async () => {
    const { app } = cloudPeer()
    const client = new PlacementRouter()
    await client.connectRemoteHost({ baseUrl: 'http://remote.invalid', token: 'token', fetch: asFetch(app) })

    let seen: Record<string, unknown> | null = null
    const eavesdrop = new Hono()
    eavesdrop.post('/placement/invoke', async context => {
      seen = (await context.req.json()) as Record<string, unknown>
      return context.json({ ok: true, value: 'ok' })
    })
    client.attachChannel(client.hosts.list()[0]!, {
      async invoke(input) {
        const response = await eavesdrop.request('/placement/invoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ owner: input.owner, toolId: input.toolId, payload: input.payload, context: input.context })
        })
        return ((await response.json()) as { value: Json }).value
      }
    })

    await client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: { url: 'https://example.com' },
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      requestId: 'request-1',
      callId: 'call-1',
      taskId: 'task-1',
      sessionId: 'session-1',
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    })
    const payload = seen as unknown as { context: Record<string, unknown>; owner: Record<string, unknown> }
    expect(Object.keys(payload.context).sort()).toEqual(['callId', 'deadline', 'grants', 'requestId', 'sessionId', 'taskId'])
    // The owner crosses the wire pinned to the exact plugin version and host instance.
    expect(payload.owner).toMatchObject({ pluginId: 'analysis', version: '1.0.0', hostEpoch: 'cloud-1:instance-1' })
    expect(JSON.stringify(payload)).not.toMatch(/adr:\/\/|file:\/\/|token|secret|apiKey/i)
  })

  it('refuses a UI host that is asked for a capability it never declared', async () => {
    const ui = new PlacementRouter()
    ui.registerLocalHost(host({
      hostId: 'ui-1',
      kind: 'ui',
      tools: ['tools/local/web/open'],
      plugins: [{ id: 'web', version: '1.0.0' }],
      bindings: { 'tools/local/web/open': { skillId: 'web.open', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, ui.routes())
    for (const toolId of ['electron.ipc.invoke', 'computer-use.permissions', 'resources.read']) {
      const response = await app.request('/placement/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: { pluginId: 'web', version: '1.0.0', hostEpoch: 'ui-1:instance-1' },
          toolId,
          payload: null,
          context: { requestId: 'r', callId: 'c', deadline: Date.now() + 1_000, grants: [] }
        })
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'PLACEMENT_UNAVAILABLE' } })
    }
  })

  it('refuses a cloud call holding only the local grant and never executes it locally', async () => {
    const { peer, app } = cloudPeer()
    const client = new PlacementRouter()
    await client.connectRemoteHost({ baseUrl: 'http://remote.invalid', token: 'token', fetch: asFetch(app) })
    const before = peer.audit().length
    await expect(client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/local/analyze@1'],
      requestId: 'r',
      callId: 'c',
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    })).rejects.toThrow(/PLACEMENT_TARGET_MISMATCH/)
    // Nothing reached the remote host, and nothing ran locally either.
    expect(peer.audit()).toHaveLength(before)
  })

  it('records a drill result for disconnect, deadline and cancellation without claiming success', async () => {
    const drill: string[] = []
    const { app } = cloudPeer()
    const client = new PlacementRouter()
    const remoteHost = await client.connectRemoteHost({ baseUrl: 'http://remote.invalid', token: 'token', fetch: asFetch(app) })

    // Disconnect: the host entry point is withdrawn and the call fails explicitly.
    client.disconnect(remoteHost.hostId, remoteHost.instanceId)
    const disconnected = await client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      requestId: 'r',
      callId: 'c',
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    }).then(() => null, (error: { code?: string }) => error)
    expect(disconnected?.code).toBe('PLACEMENT_NO_HOST')
    drill.push('disconnect -> PLACEMENT_NO_HOST (no local fallback)')

    // Deadline: a host that never answers leaves an explicit unknown outcome.
    const stalled = new PlacementRouter()
    stalled.registerLocalHost(host({
      hostId: 'cloud-1',
      kind: 'cloud',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    stalled.attachChannel(stalled.hosts.list()[0]!, {
      async invoke() { return await new Promise<never>(() => {}) }
    })
    const expired = await stalled.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      requestId: 'r',
      callId: 'c',
      deadline: Date.now() + 30,
      signal: new AbortController().signal
    }).then(() => null, (error: { code?: string }) => error)
    expect(expired?.code).toBe('PLACEMENT_RESULT_UNKNOWN')
    drill.push('deadline -> PLACEMENT_RESULT_UNKNOWN (no success claim)')

    // Cancellation: the host is asked to stop and the caller records the outcome it confirmed.
    const cancelling = new PlacementRouter()
    cancelling.registerLocalHost(host({
      hostId: 'cloud-1',
      kind: 'cloud',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    let cancelled = false
    cancelling.attachChannel(cancelling.hosts.list()[0]!, {
      async invoke({ signal }) {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve() }, { once: true }))
        throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
      }
    })
    const controller = new AbortController()
    const call = cancelling.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      requestId: 'r',
      callId: 'c',
      deadline: Date.now() + 5_000,
      signal: controller.signal
    })
    controller.abort()
    const outcome = await call.then(() => null, (error: { code?: string }) => error)
    expect(cancelled).toBe(true)
    expect(outcome?.code).toBe('PLACEMENT_RESULT_UNKNOWN')
    drill.push('cancel -> PLACEMENT_RESULT_UNKNOWN (unconfirmed side effect)')

    expect(drill).toEqual([
      'disconnect -> PLACEMENT_NO_HOST (no local fallback)',
      'deadline -> PLACEMENT_RESULT_UNKNOWN (no success claim)',
      'cancel -> PLACEMENT_RESULT_UNKNOWN (unconfirmed side effect)'
    ])
  })
})
