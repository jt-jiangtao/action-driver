// @vitest-environment node
import {
  ModelServiceError,
  type ModelConnectionDto,
  type ModelConnectionServicePort
} from '@actiondriver/model-connections'
import {
  createInteractionLogRecorder,
  MemoryInteractionLogStore,
  type InteractionLogRecorder
} from '@actiondriver/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServiceHttpServer, type ServiceHttpServer } from '../../src/service/http-service'
import { openRuntimeDatabase } from '../../src/database'
import { SessionAssetStore } from '../../src/media/session-asset-store'
import { SessionInputFileStore } from '../../src/media/session-input-file-store'
import { SessionWorkspaceStore } from '../../src/execution/session-workspace'
import type { AgentFileStore } from '../../src/agent-files/agent-file-store'
import type { SkillInstaller } from '../../src/agent-files/skill-installer'
import { AppApprovalError } from '../../src/computer-use/app-approval-broker'

const connection: ModelConnectionDto = {
  id: 'company-gateway',
  name: '公司模型网关',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKeyHint: '••••alue',
  expanded: true,
  models: [{ id: 'qwen3.7-plus', name: 'qwen3.7-plus', enabled: true, testState: 'success' }]
}

let server: ServiceHttpServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

function serviceStub(overrides: Record<string, unknown> = {}) {
  const base = {
    list: () => [connection],
    testConnection: vi.fn(async () => ({ ok: true })),
    discover: vi.fn(async () => connection.models),
    refresh: vi.fn(async () => connection.models),
    testModels: vi.fn(async () => [{ modelId: 'qwen3.7-plus', state: 'success' }]),
    testConnectionModels: vi.fn(async () => [{ modelId: 'qwen3.7-plus', state: 'unsupported' }]),
    setModelEnabled: vi.fn(async () => undefined),
    add: vi.fn(async () => connection),
    delete: vi.fn(async () => undefined),
    ...overrides
  }
  return base as unknown as ModelConnectionServicePort & typeof base
}

async function startService(
  overrides: Record<string, unknown> = {},
  interactions?: InteractionLogRecorder,
  rendererOrigin?: string,
  agentFiles?: AgentFileStore
) {
  const service = serviceStub(overrides)
  server = await startServiceHttpServer({
    service,
    token: 'service-token',
    runtimeVersion: '0.1.0',
    ...(interactions ? { interactions } : {}),
    ...(rendererOrigin ? { rendererOrigin } : {}),
    ...(agentFiles ? { agentFiles } : {})
  })
  return { service, url: server.url }
}

function recordingInteractions() {
  const store = new MemoryInteractionLogStore()
  let sequence = 0
  const interactions = createInteractionLogRecorder({
    store,
    ids: {
      eventId: () => `service:event-${++sequence}`,
      correlationId: () => `correlation-${sequence}`
    },
    clock: Date.now
  })
  return { interactions, store }
}

function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${server!.url}${path}`, {
    ...init,
    headers: { authorization: 'Bearer service-token', ...(init.headers ?? {}) }
  })
}

describe('service HTTP surface', () => {
  it('accepts and returns per-capability model results', async () => {
    const capabilities = {
      text: { state: 'success', source: 'probe' },
      image_generation: {
        state: 'failed',
        source: 'probe',
        failure: { code: 'provider-error', message: 'Generation failed' }
      }
    } as const
    const add = vi.fn(async () => ({
      ...connection,
      models: [
        { id: 'hybrid', name: 'hybrid', enabled: true, testState: 'success' as const, capabilities }
      ]
    }))
    const testModels = vi.fn(async () => [
      { modelId: 'hybrid', state: 'success' as const, capabilities }
    ])
    await startService({ add, testModels })
    const result = await authorized('/model-connections/test-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draft: {
          name: 'Gateway',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test'
        },
        modelIds: ['hybrid']
      })
    })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ value: [{ modelId: 'hybrid', capabilities }] })
    const saved = await authorized('/model-connections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draft: {
          name: 'Gateway',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-test'
        },
        models: [
          { id: 'hybrid', name: 'hybrid', enabled: true, testState: 'success', capabilities }
        ]
      })
    })
    expect(saved.status).toBe(200)
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ models: [expect.objectContaining({ capabilities })] })
    )
  })
  it('routes image capability and default model settings through authenticated APIs', async () => {
    const setDefaultImageModel = vi.fn(async () => undefined)
    const getDefaultImageModel = vi.fn(async () => ({
      connectionId: 'company-gateway',
      modelId: 'image'
    }))
    await startService({ setDefaultImageModel, getDefaultImageModel })
    const model = { connectionId: 'company-gateway', modelId: 'image' }
    const chosen = await authorized('/model-connections/default-image-model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model })
    })
    expect(chosen.status).toBe(200)
    expect(setDefaultImageModel).toHaveBeenCalledWith(model)
    expect(
      await authorized('/model-connections/default-image-model').then((r) => r.json())
    ).toMatchObject({ ok: true, value: model })
  })

  it('authenticates binary image upload/read and never logs image bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'actiondriver-image-http-'))
    const database = openRuntimeDatabase(join(root, 'actiondriver.db'))
    const assets = new SessionAssetStore({ database, rootDirectory: root })
    const { interactions, store } = recordingInteractions()
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      assets,
      interactions
    })
    const image = readFileSync(join(process.cwd(), 'apps/agent-runtime/tests/fixtures/tiny.png'))
    try {
      const unauthorized = await fetch(`${server.url}/assets/staged`, {
        method: 'POST',
        body: image,
        headers: { 'content-type': 'image/png' }
      })
      expect(unauthorized.status).toBe(401)
      const oversized = await authorized('/assets/staged', {
        method: 'POST',
        body: Buffer.alloc(20 * 1024 * 1024 + 1),
        headers: { 'content-type': 'image/png' }
      })
      expect(oversized.status).toBe(413)
      const uploaded = await authorized('/assets/staged', {
        method: 'POST',
        body: image,
        headers: { 'content-type': 'image/png' }
      })
      expect(uploaded.status).toBe(200)
      const ref = ((await uploaded.json()) as { value: { assetId: string } }).value
      await assets.bindStaged(ref.assetId, 'session-a')
      const read = await authorized(`/sessions/session-a/assets/${ref.assetId}`)
      expect(read.status).toBe(200)
      expect(Buffer.from(await read.arrayBuffer())).toEqual(image)
      expect((await authorized(`/sessions/session-b/assets/${ref.assetId}`)).status).toBe(404)
      expect((await authorized('/sessions/session-a/assets/missing')).status).toBe(404)
      const log = JSON.stringify(await store.list({ limit: 100 }))
      expect(log).not.toContain(image.toString('base64'))
      expect(log).not.toContain('PNG\r\n')
    } finally {
      await server?.close()
      server = undefined
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stages document uploads with their name and format', async () => {
    const root = mkdtempSync(join(tmpdir(), 'actiondriver-input-http-'))
    const database = openRuntimeDatabase(join(root, 'actiondriver.db'))
    const inputFiles = new SessionInputFileStore({
      database,
      rootDirectory: root,
      workspaces: new SessionWorkspaceStore({ workspaceRoot: join(root, 'workspace') })
    })
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      inputFiles
    })
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
    const upload = (name: string, body: Uint8Array, type: string) =>
      authorized('/input-files/staged', {
        method: 'POST',
        body: new Uint8Array(body),
        headers: { 'content-type': type, 'x-actiondriver-file-name': encodeURIComponent(name) }
      })
    try {
      expect((await fetch(`${server.url}/input-files/staged`, { method: 'POST' })).status).toBe(401)
      const missingName = await authorized('/input-files/staged', {
        method: 'POST',
        body: new Uint8Array(pdf),
        headers: { 'content-type': 'application/pdf' }
      })
      expect(missingName.status).toBe(400)
      const unsupported = await upload('notes.txt', Buffer.from('hello'), 'text/plain')
      expect(unsupported.status).toBe(400)
      await expect(unsupported.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'INPUT_FILE_TYPE_UNSUPPORTED' }
      })
      const mismatched = await upload('fake.pdf', Buffer.from('not a pdf'), 'application/pdf')
      expect(mismatched.status).toBe(400)
      await expect(mismatched.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'INPUT_FILE_CONTENT_INVALID' }
      })
      const oversized = await upload(
        'huge.pdf',
        Buffer.concat([pdf, Buffer.alloc(50 * 1024 * 1024)]),
        'application/pdf'
      )
      expect(oversized.status).toBe(413)
      const stored = await upload('季度报告.pdf', pdf, 'application/pdf')
      expect(stored.status).toBe(200)
      await expect(stored.json()).resolves.toMatchObject({
        ok: true,
        value: { name: '季度报告.pdf', mimeType: 'application/pdf', byteLength: pdf.byteLength }
      })
    } finally {
      await server?.close()
      server = undefined
      database.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('serves prompt and Skill definitions from the Runtime file service', async () => {
    const fileStore = {
      getMainPrompt: vi.fn(async () => ({
        path: '.action-driver/prompts/main.md',
        content: '# Prompt',
        digest: 'digest',
        modifiedAt: '2026-09-24T00:00:00.000Z'
      })),
      listSkills: vi.fn(async () => [])
    } as unknown as AgentFileStore
    await startService({}, undefined, undefined, fileStore)
    const prompt = await authorized('/agent-files/main-prompt')
    expect(prompt.status).toBe(200)
    await expect(prompt.json()).resolves.toMatchObject({ ok: true, value: { content: '# Prompt' } })
    const skills = await authorized('/agent-files/skills')
    expect(skills.status).toBe(200)
    await expect(skills.json()).resolves.toMatchObject({ ok: true, value: [] })
  })

  it('routes Skill installation through the shared installer', async () => {
    const installSkill = vi.fn(async () => ({ id: 'writer', source: 'local' }))
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      agentFiles: { listSkills: async () => [] } as unknown as AgentFileStore,
      skillInstaller: { installSkill } as unknown as SkillInstaller
    })
    const response = await authorized('/agent-files/skills/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'local', path: '/tmp/writer' })
    })
    expect(response.status).toBe(200)
    expect(installSkill).toHaveBeenCalledWith({ source: 'local', path: '/tmp/writer' })
  })

  it('serves task reads and controls from the Runtime task service', async () => {
    const execute = vi.fn(async (command: string) =>
      command === 'task.get'
        ? { task: { id: 'task-1' } }
        : command === 'task.list'
          ? { tasks: [{ id: 'task-1' }] }
          : { accepted: true }
    )
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      taskControl: { execute }
    })
    await expect(
      authorized('/tasks/task-1').then((response) => response.json())
    ).resolves.toMatchObject({ ok: true, value: { task: { id: 'task-1' } } })
    await expect(
      authorized('/tasks?limit=10').then((response) => response.json())
    ).resolves.toMatchObject({ ok: true, value: { tasks: [{ id: 'task-1' }] } })
    await authorized('/tasks/task-1/interrupt', { method: 'POST' })
    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      'task.get',
      'task.list',
      'task.interrupt'
    ])
  })

  // 3.2: the settings page reads and revokes persisted "always allow" grants over these routes.
  it('exposes the always-allowed grants and validates the removal body', async () => {
    const execute = vi.fn(async () => ({ bundleIds: ['com.apple.Notes'] }))
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      taskControl: { execute }
    })
    expect((await authorized('/computer-use/always-allowed')).status).toBe(200)
    expect(execute).toHaveBeenCalledWith('computer-use.always-allowed.list', {})
    const removed = await authorized('/computer-use/always-allowed/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundleId: 'com.apple.Notes' })
    })
    expect(removed.status).toBe(200)
    expect(execute).toHaveBeenCalledWith('computer-use.always-allowed.remove', {
      bundleId: 'com.apple.Notes'
    })
    const invalidBody = await authorized('/computer-use/always-allowed/remove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bundleId: '' })
    })
    expect(invalidBody.status).toBe(400)
  })

  it('routes application decisions through a dedicated command and validates the body', async () => {
    const execute = vi.fn(async () => ({ accepted: true }))
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      taskControl: { execute }
    })
    const path = '/tasks/task-1/app-approvals/approval-1/decision'
    const response = await authorized(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'session' })
    })
    expect(response.status).toBe(200)
    expect(execute).toHaveBeenCalledExactlyOnceWith('task.decide-app-approval', {
      taskId: 'task-1',
      requestId: 'approval-1',
      decision: 'session'
    })
    for (const body of [{ decision: 'invalid' }, { decision: 'once', value: 'injected' }, {}]) {
      const invalid = await authorized(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      expect(invalid.status).toBe(400)
    }
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reports stale application decisions as a conflict', async () => {
    server = await startServiceHttpServer({
      service: serviceStub(),
      token: 'service-token',
      runtimeVersion: '0.1.0',
      taskControl: {
        execute: async () => {
          throw new AppApprovalError('APPROVAL_STALE', 'approval ended')
        }
      }
    })
    const response = await authorized('/tasks/task-1/app-approvals/approval-1/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'once' })
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'APPROVAL_STALE' }
    })
  })

  it('rejects invalid write payloads with 400 before calling the service', async () => {
    const { service } = await startService()
    const cases = [
      ['/model-connections', { draft: { name: 'bad' }, models: [] }],
      ['/model-connections/test', { name: 'bad', protocol: 'invalid', baseUrl: '', apiKey: '' }],
      ['/model-connections/discover', { name: 'bad' }],
      ['/model-connections/test-models', { draft: { name: 'bad' }, modelIds: [1] }],
      ['/model-connections/company-gateway/test-models', { modelIds: [1] }],
      ['/model-connections/company-gateway/models/qwen3.7-plus', { enabled: 'yes' }]
    ] as const
    for (const [path, body] of cases) {
      const response = await authorized(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-request' }
      })
    }
    expect(service.add).not.toHaveBeenCalled()
    expect(service.testConnection).not.toHaveBeenCalled()
    expect(service.discover).not.toHaveBeenCalled()
    expect(service.testModels).not.toHaveBeenCalled()
    expect(service.testConnectionModels).not.toHaveBeenCalled()
    expect(service.setModelEnabled).not.toHaveBeenCalled()
  })

  it('answers health probes without a credential', async () => {
    await startService()

    const response = await fetch(`${server!.url}/readyz`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('rejects browser origins so a rendered page cannot drive the service', async () => {
    await startService()

    const response = await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer service-token', origin: 'http://localhost:5173' }
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized' }
    })
  })

  it('allows only the configured Renderer origin with a valid token and scoped preflight', async () => {
    await startService({}, undefined, 'http://localhost:5173')
    const preflight = await fetch(`${server!.url}/model-connections`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization'
      }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')

    const putPreflight = await fetch(
      `${server!.url}/model-connections/company-gateway/models/image/image-generation-api`,
      {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'authorization,content-type'
        }
      }
    )
    expect(putPreflight.status).toBe(204)
    expect(putPreflight.headers.get('access-control-allow-methods')).toContain('PUT')

    const uploadPreflight = await fetch(`${server!.url}/input-files/staged`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-actiondriver-file-name'
      }
    })
    expect(uploadPreflight.status).toBe(204)
    expect(uploadPreflight.headers.get('access-control-allow-headers')).toContain(
      'X-ActionDriver-File-Name'
    )

    const allowed = await authorized('/model-connections', {
      headers: { origin: 'http://localhost:5173' }
    })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')

    const noToken = await fetch(`${server!.url}/model-connections`, {
      headers: { origin: 'http://localhost:5173' }
    })
    expect(noToken.status).toBe(401)

    const foreign = await authorized('/model-connections', {
      headers: { origin: 'http://localhost:5174' }
    })
    expect(foreign.status).toBe(403)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('requires the service credential for business routes', async () => {
    await startService()

    const anonymous = await fetch(`${server!.url}/model-connections`)
    expect(anonymous.status).toBe(401)

    const wrong = await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer wrong-token' }
    })
    expect(wrong.status).toBe(401)
  })

  it('serves configuration over the authorized HTTP surface', async () => {
    const { service } = await startService()

    await expect(authorized('/version').then((r) => r.json())).resolves.toEqual({
      ok: true,
      value: { runtimeVersion: '0.1.0', protocolVersion: 1 }
    })
    await expect(authorized('/model-connections').then((r) => r.json())).resolves.toEqual({
      ok: true,
      value: [connection]
    })

    await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    })
    expect(service.testConnection).toHaveBeenCalledOnce()
  })

  it('routes connection scoped operations', async () => {
    const { service } = await startService()

    await authorized('/model-connections/company-gateway/refresh', { method: 'POST' })
    expect(service.refresh).toHaveBeenCalledWith('company-gateway')

    await authorized('/model-connections/company-gateway/test-models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelIds: ['qwen3.7-plus'] })
    })
    expect(service.testConnectionModels).toHaveBeenCalledWith({
      connectionId: 'company-gateway',
      modelIds: ['qwen3.7-plus']
    })

    await authorized('/model-connections/company-gateway/models/qwen3.7-plus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    })
    expect(service.setModelEnabled).toHaveBeenCalledWith({
      connectionId: 'company-gateway',
      modelId: 'qwen3.7-plus',
      enabled: false
    })

    const retired = await authorized(
      '/model-connections/company-gateway/models/qwen3.7-plus/kind',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'image' })
      }
    )
    expect(retired.status).toBe(404)

    await authorized('/model-connections/company-gateway', { method: 'DELETE' })
    expect(service.delete).toHaveBeenCalledWith('company-gateway')
  })

  it('returns structured errors and rejects unknown routes', async () => {
    await startService({
      list: () => {
        throw new Error('storage exploded')
      }
    })

    const failed = await authorized('/model-connections')
    await expect(failed.json()).resolves.toMatchObject({ ok: false, error: { code: 'unknown' } })

    const missing = await authorized('/unknown')
    expect(missing.status).toBe(404)
  })

  it('rejects malformed request bodies', async () => {
    await startService()

    const response = await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json'
    })

    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
  })

  it('rejects an oversized body before reaching the model service', async () => {
    const service = serviceStub()
    server = await startServiceHttpServer({
      service,
      token: 'service-token',
      runtimeVersion: '0.1.0',
      bodyLimitBytes: 64
    })
    const response = await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'too large',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'x'.repeat(1024)
      })
    })
    expect(response.status).toBe(400)
    expect(service.testConnection).not.toHaveBeenCalled()
  })

  it('records HTTP request/response pairs without credentials, including removed-route attempts', async () => {
    const { interactions, store } = recordingInteractions()
    await startService({}, interactions)

    await fetch(`${server!.url}/model-connections`, {
      headers: { authorization: 'Bearer wrong-token' }
    })
    await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    })
    await authorized('/logs')

    const records = (await store.list({ limit: 20 })).records
    expect(records.map((record) => record.operation).sort()).toEqual([
      'GET /logs',
      'GET /model-connections',
      'POST /model-connections/test'
    ])
    const details = await Promise.all(records.map((record) => store.getDetail(record.id)))
    expect(JSON.stringify(details)).toContain('公司模型网关')
    expect(JSON.stringify(details)).not.toContain('service-token')
    expect(JSON.stringify(details)).not.toContain('wrong-token')
    expect(JSON.stringify(details)).not.toContain('sk-secret-value')
    expect(details.every((detail) => detail?.responseAvailable)).toBe(true)
  })

  it('records a pending HTTP event before the service completes and includes service duration', async () => {
    const { interactions, store } = recordingInteractions()
    let release!: () => void
    const waiting = new Promise<ModelConnectionDto[]>((resolve) => {
      release = () => resolve([connection])
    })
    await startService({ list: () => waiting }, interactions)

    const responsePromise = authorized('/model-connections')
    await vi.waitFor(async () => {
      expect((await store.list({ limit: 20 })).records[0]?.state).toBe('pending')
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    expect((await responsePromise).status).toBe(200)

    expect((await store.list({ limit: 20 })).records[0]).toMatchObject({
      state: 'completed',
      outcome: 'ok'
    })
    expect((await store.list({ limit: 20 })).records[0]!.durationMs).toBeGreaterThanOrEqual(10)
  })

  it('does not persist an API key reflected by a provider error', async () => {
    const { interactions, store } = recordingInteractions()
    await startService(
      {
        testConnection: () => {
          throw new ModelServiceError('provider-error', 'Invalid API key: sk-secret-value')
        }
      },
      interactions
    )

    await authorized('/model-connections/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '公司模型网关',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-value'
      })
    })

    const record = (await store.list({ limit: 20 })).records[0]!
    expect(JSON.stringify(await store.getDetail(record.id))).not.toContain('sk-secret-value')
  })

  it('keeps HTTP business responses successful when interaction storage fails', async () => {
    let calls = 0
    const interactions: InteractionLogRecorder = {
      async start() {
        calls += 1
        if (calls === 1) throw new Error('disk unavailable')
        return Object.assign(
          async () => {
            throw new Error('disk full')
          },
          { run: <T>(operation: () => Promise<T>) => operation() }
        )
      },
      async recordOneWay() {
        throw new Error('disk unavailable')
      }
    }
    await startService({}, interactions)

    expect((await authorized('/model-connections')).status).toBe(200)
    expect((await authorized('/model-connections')).status).toBe(200)
  })
})
