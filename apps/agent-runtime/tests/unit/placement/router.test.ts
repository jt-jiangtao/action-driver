// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Json } from '@actiondriver/plugin-contracts'
import { registerPlacementRoutes } from '../../../src/placement/routes'
import { PLACEMENT_HOSTS_ENV, PlacementRouter, parseRemoteHostDeclarations, type LocalHostOptions } from '../../../src/placement/router'
import { RuntimeSkillRegistry } from '../../../src/skill-registry'

function provider(skillId: string, output: Json) {
  return {
    providerId: `provider-${skillId}`,
    providerVersion: '1.0.0',
    skillId,
    contractVersion: 1,
    async execute(request: { invocationId: string; input: unknown }) {
      return { ok: true as const, providerId: `provider-${skillId}`, input: { echo: request.input, output } }
    }
  }
}

function hostOptions(overrides: Partial<LocalHostOptions> & Pick<LocalHostOptions, 'hostId' | 'kind' | 'tools' | 'bindings'>): LocalHostOptions {
  const skills = new RuntimeSkillRegistry()
  for (const binding of Object.values(overrides.bindings)) skills.register(provider(binding.skillId, binding.skillId))
  return {
    instanceId: 'instance-1',
    devices: ['network', 'filesystem'],
    workspace: 'session-workspace',
    plugins: [],
    resolve: (skillId, contractVersion) => skills.resolve(skillId, contractVersion),
    ...overrides
  }
}

function asFetch(app: Hono): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    app.request(input instanceof Request ? input : new Request(String(input), init))) as unknown as typeof fetch
}

const call = (overrides: Record<string, unknown> = {}) => ({
  requestId: 'request-1',
  callId: `call-${Math.random().toString(36).slice(2, 8)}`,
  taskId: 'task-1',
  sessionId: 'session-1',
  deadline: Date.now() + 5_000,
  signal: new AbortController().signal,
  ...overrides
})

describe('placement router', () => {
  it('keeps an undeclared local tool on the legacy in-process path', async () => {
    const router = new PlacementRouter()
    router.registerLocalHost(hostOptions({
      hostId: 'desktop-1',
      kind: 'local-workspace',
      tools: ['tools/local/web/open'],
      bindings: { 'tools/local/web/open': { skillId: 'web.open', contractVersion: 1 } }
    }))
    const outcome = await router.invoke({
      toolId: 'tools/local/web/open',
      payload: null,
      plugin: { id: 'legacy-plugin', version: '1.0.0' },
      grants: ['tools/local/web/open@1'],
      ...call()
    })
    expect(outcome).toEqual({ placed: false, reason: 'local-only' })
  })

  it('routes a cloud tool to the remote host that serves it and returns its value', async () => {
    const remote = new PlacementRouter({ now: () => 1_000 })
    remote.registerLocalHost(hostOptions({
      hostId: 'cloud-1',
      kind: 'remote-workspace',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, remote.routes())

    const client = new PlacementRouter()
    const host = await client.connectRemoteHost({
      hostId: 'cloud-1',
      baseUrl: 'http://remote.invalid',
      token: 'token',
      fetch: asFetch(app),
      kind: 'remote-workspace',
      target: 'cloud',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }]
    })
    expect(host.hostId).toBe('cloud-1')

    const outcome = await client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: { url: 'https://example.com' },
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['remote-workspace', 'cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      ...call()
    })
    expect(outcome.placed).toBe(true)
    if (!outcome.placed) throw new Error('unreachable')
    expect(outcome.location).toBe('remote-workspace')
    expect(outcome.value).toMatchObject({ output: 'analysis.run' })
  })

  it('refuses a remote call without the cloud grant instead of falling back locally', async () => {
    const remote = new PlacementRouter()
    remote.registerLocalHost(hostOptions({
      hostId: 'cloud-1',
      kind: 'remote-workspace',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, remote.routes())
    const client = new PlacementRouter()
    await client.connectRemoteHost({ hostId: 'cloud-1', baseUrl: 'http://remote.invalid', token: 'token', fetch: asFetch(app), kind: 'cloud', tools: ['tools/cloud/analyze'] })

    await expect(client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/local/analyze@1'],
      ...call()
    })).rejects.toThrow(/PLACEMENT_TARGET_MISMATCH/)
  })

  it('fails explicitly when a remote-only plugin has no connected host', async () => {
    const client = new PlacementRouter()
    await expect(client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      ...call()
    })).rejects.toThrow(/PLACEMENT_NO_HOST/)
  })

  it('refuses a remote call pinned to a superseded host instance', async () => {
    const remote = new PlacementRouter()
    remote.registerLocalHost(hostOptions({
      hostId: 'cloud-1',
      kind: 'remote-workspace',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, remote.routes())
    const response = await app.request('/placement/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: { pluginId: 'analysis', version: '1.0.0', hostEpoch: 'cloud-1:an-older-instance' },
        toolId: 'tools/cloud/analyze',
        payload: null,
        context: { requestId: 'r', callId: 'c', deadline: Date.now() + 1_000, grants: ['tools/cloud/analyze@1'] }
      })
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'PLACEMENT_STALE_INSTANCE' } })
  })

  it('exposes only declared tool bindings, so a UI host cannot be asked for arbitrary capabilities', async () => {
    const local = new PlacementRouter()
    local.registerLocalHost(hostOptions({
      hostId: 'ui-1',
      kind: 'ui',
      tools: ['tools/local/web/open'],
      bindings: { 'tools/local/web/open': { skillId: 'web.open', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, local.routes())
    const response = await app.request('/placement/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: { pluginId: 'web', version: '1.0.0', hostEpoch: 'ui-1:instance-1' },
        toolId: 'electron.ipc.raw',
        payload: null,
        context: { requestId: 'r', callId: 'c', deadline: Date.now() + 1_000, grants: [] }
      })
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'PLACEMENT_UNAVAILABLE' } })
  })

  it('records host handshakes and placement decisions for audit', async () => {
    const remote = new PlacementRouter({ now: () => 1_000 })
    remote.registerLocalHost(hostOptions({
      hostId: 'cloud-1',
      kind: 'remote-workspace',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } }
    }))
    const app = new Hono()
    registerPlacementRoutes(app, remote.routes())
    const client = new PlacementRouter({ now: () => 2_000 })
    await client.connectRemoteHost({ hostId: 'cloud-1', baseUrl: 'http://remote.invalid', token: 'token', fetch: asFetch(app), kind: 'cloud', tools: ['tools/cloud/analyze'] })
    await client.invoke({
      toolId: 'tools/cloud/analyze',
      payload: null,
      plugin: { id: 'analysis', version: '1.0.0' },
      declaration: { locations: ['cloud'], workspace: 'none', protocol: 1 },
      grants: ['tools/cloud/analyze@1'],
      ...call()
    })
    const kinds = client.audit().map(entry => entry.kind)
    expect(kinds).toContain('host.connected')
    expect(kinds).toContain('placement.selected')
    expect(remote.audit().map(entry => entry.kind)).toContain('host.connected')
  })

  it('reports cancellation to the host and only acknowledges a settled call', async () => {
    const remote = new PlacementRouter()
    const skills = new RuntimeSkillRegistry()
    let aborted = false
    skills.register({
      providerId: 'provider-analysis',
      providerVersion: '1.0.0',
      skillId: 'analysis.run',
      contractVersion: 1,
      async execute(_request: { invocationId: string; input: unknown }, signal?: AbortSignal) {
        await new Promise<void>(resolve => {
          signal?.addEventListener('abort', () => { aborted = true; resolve() }, { once: true })
          setTimeout(resolve, 5_000)
        })
        return { ok: true as const, providerId: 'provider-analysis', input: null }
      }
    })
    remote.registerLocalHost({
      hostId: 'cloud-1',
      instanceId: 'instance-1',
      kind: 'remote-workspace',
      devices: [],
      workspace: 'none',
      tools: ['tools/cloud/analyze'],
      plugins: [{ id: 'analysis', version: '1.0.0' }],
      bindings: { 'tools/cloud/analyze': { skillId: 'analysis.run', contractVersion: 1 } },
      resolve: (skillId, contractVersion) => skills.resolve(skillId, contractVersion)
    })
    const app = new Hono()
    registerPlacementRoutes(app, remote.routes())
    const controller = new AbortController()
    const invoke = app.request('/placement/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: { pluginId: 'analysis', version: '1.0.0', hostEpoch: 'cloud-1:instance-1' },
        toolId: 'tools/cloud/analyze',
        payload: null,
        context: { requestId: 'r', callId: 'call-1', deadline: Date.now() + 5_000, grants: [] }
      }),
      signal: controller.signal
    })
    const cancelled = await app.request('/placement/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: { pluginId: 'analysis', version: '1.0.0', hostEpoch: 'cloud-1:instance-1' }, callId: 'call-1' })
    })
    expect(await cancelled.json()).toMatchObject({ ok: true, value: { acknowledged: true } })
    expect(aborted).toBe(true)
    controller.abort()
    await invoke
  })

  it('declares remote hosts by configuration and rolls back to the local path when none is set', async () => {
    expect(parseRemoteHostDeclarations({})).toEqual([])
    const declared = parseRemoteHostDeclarations({
      [PLACEMENT_HOSTS_ENV]: JSON.stringify([{ baseUrl: 'http://remote.invalid', token: 'token', hostId: 'cloud-1' }])
    })
    expect(declared).toHaveLength(1)
    expect(() => parseRemoteHostDeclarations({ [PLACEMENT_HOSTS_ENV]: 'not json' })).toThrow(/valid JSON/)
    expect(() => parseRemoteHostDeclarations({ [PLACEMENT_HOSTS_ENV]: JSON.stringify([{ baseUrl: 'file:///etc', token: 't' }]) })).toThrow(/baseUrl/)
    expect(() => parseRemoteHostDeclarations({ [PLACEMENT_HOSTS_ENV]: JSON.stringify([{ baseUrl: 'http://x' }]) })).toThrow(/token/)

    // With no remote host configured the local tool keeps its legacy in-process path even when the
    // plugin declares a location it could run in elsewhere.
    const router = new PlacementRouter()
    router.registerLocalHost(hostOptions({
      hostId: 'desktop-1',
      kind: 'local-workspace',
      tools: ['tools/local/web/open'],
      bindings: { 'tools/local/web/open': { skillId: 'web.open', contractVersion: 1 } }
    }))
    const outcome = await router.invoke({
      toolId: 'tools/local/web/open',
      payload: null,
      plugin: { id: 'web', version: '1.0.0' },
      declaration: { locations: ['ui', 'local-workspace'], workspace: 'none', protocol: 1 },
      grants: ['tools/local/web/open@1'],
      ...call()
    })
    expect(outcome).toEqual({ placed: false, reason: 'local-only' })
  })
})

void vi
