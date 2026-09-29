// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResourceError } from '@actiondriver/runtime-contracts'
import { openRuntimeDatabase } from '../../../src/database'
import { SessionWorkspaceStore } from '../../../src/execution/session-workspace'
import { SessionInputFileStore } from '../../../src/media/session-input-file-store'
import { SessionOutputStore } from '../../../src/media/session-output-store'
import { createInputFileStore } from '../../../src/persistence/input-file-store'
import { createResourceHttpPort, createRuntimeResourceRegistryFromStores } from '../../../src/resources/runtime-resources'
import { createHttpRemoteResourceTransport } from '../../../src/resources/remote-http-transport'
import { createRemoteResourceProvider } from '../../../src/resources/remote-provider'
import { ResourceProviderRegistry } from '../../../src/resources/registry'
import { VersionedResourceStore } from '../../../src/resources/store'
import { createSessionScopedStoreProvider } from '../../../src/resources/work-provider'
import { registerServiceMetadataRoutes } from '../../../src/service/http/http-routes-service'
import { registerResourceRoutes } from '../../../src/service/http/http-routes-resources'
import { mapErrorToResponse } from '../../../src/service/http/http-errors'
import { failure } from '../../../src/service/http/http-contract'
import { toOutputFileProjection } from '../../../src/task-projection'

const temporaryDirectories: string[] = []
const PDF_V1 = Buffer.from('%PDF-1.7\n1 0 obj\n<<v1>>\nendobj\ntrailer\n%%EOF\n')
const PDF_V2 = Buffer.from('%PDF-1.7\n1 0 obj\n<<v2>>\nendobj\ntrailer\n%%EOF\n')

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'actiondriver-resource-e2e-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function boot(root: string) {
  const database = openRuntimeDatabase(join(root, 'actiondriver.db'))
  const workspaces = new SessionWorkspaceStore({ workspaceRoot: join(root, 'workspace') })
  const inputFiles = new SessionInputFileStore({ database, rootDirectory: root, workspaces })
  const outputs = new SessionOutputStore({ database, rootDirectory: root, workspaces })
  const { registry, workStore } = createRuntimeResourceRegistryFromStores({
    inputFiles,
    inputFileRecords: createInputFileStore(database).inputFiles,
    outputs,
    resourceRoot: join(root, 'resources')
  })
  return { database, workspaces, inputFiles, outputs, registry, workStore }
}

/** The runtime's HTTP resource surface, mounted exactly like the service app. */
function serviceApp(registry: ReturnType<typeof boot>['registry'], token = 'service-token') {
  const app = new Hono()
  app.use('*', async (context, next) => {
    if (context.req.header('authorization') !== `Bearer ${token}`) return context.json(failure('unauthorized', 'Unauthorized'), 401)
    await next()
  })
  app.onError((error, context) => {
    const mapped = mapErrorToResponse(error)
    return context.json(failure(mapped.code, mapped.message), mapped.status)
  })
  registerServiceMetadataRoutes(app, { runtimeVersion: '0.1.0' })
  registerResourceRoutes(app, createResourceHttpPort(registry))
  return app
}

function asFetch(app: Hono): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    app.request(input instanceof Request ? input : new Request(String(input), init))) as unknown as typeof fetch
}

async function readJson(response: Response): Promise<{ ok: boolean; value?: { base64?: string; byteLength?: number }; error?: { code?: string } }> {
  return (await response.json()) as { ok: boolean; value?: { base64?: string; byteLength?: number }; error?: { code?: string } }
}

async function writeOutput(root: string, sessionId: string, name: string, bytes: Buffer) {
  const path = join(root, 'workspace', 'sessions', sessionId, 'output', name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
}

describe('resource platform end to end', () => {
  it('keeps old cards, same-session inputs, remote reads and concurrent writes correct across a restart', async () => {
    const root = directory()
    const first = boot(root)
    const app = serviceApp(first.registry)

    // --- an old task card keeps reading its registered snapshot -------------------------------
    const baseline = await first.outputs.baseline('session-1')
    await writeOutput(root, 'session-1', 'report.pdf', PDF_V1)
    const [oldOutput] = await first.outputs.register({ sessionId: 'session-1', taskId: 'task-1', files: await first.outputs.detectChanges('session-1', baseline) })
    const card = toOutputFileProjection(oldOutput!)
    expect(card.uri).toBe(`adr://v1/generated-output/${oldOutput!.fileId}?task=task-1&session=session-1`)
    const next = await first.outputs.baseline('session-1')
    await writeOutput(root, 'session-1', 'report.pdf', PDF_V2)
    await first.outputs.register({ sessionId: 'session-1', taskId: 'task-2', files: await first.outputs.detectChanges('session-1', next) })

    const cardRead = await readJson(await app.request('/resources/read', {
      method: 'POST',
      headers: { authorization: 'Bearer service-token', 'content-type': 'application/json' },
      body: JSON.stringify({ uri: card.uri, taskId: card.taskId, sessionId: card.sessionId })
    }))
    expect(Buffer.from(cardRead.value!.base64!, 'base64').toString()).toBe(PDF_V1.toString())

    // --- a same-session input is readable, another session is refused -------------------------
    const staged = await first.inputFiles.stageUpload({ bytes: PDF_V1, name: 'brief.pdf', mimeType: 'application/pdf' })
    await first.inputFiles.bind(staged.fileId, { sessionId: 'session-1', taskId: 'task-1' })
    const inputUri = `adr://v1/session-input/${staged.fileId}?session=session-1`
    const ownRead = await readJson(await app.request('/resources/read', {
      method: 'POST',
      headers: { authorization: 'Bearer service-token', 'content-type': 'application/json' },
      body: JSON.stringify({ uri: inputUri, sessionId: 'session-1' })
    }))
    expect(Buffer.from(ownRead.value!.base64!, 'base64').toString()).toBe(PDF_V1.toString())
    const foreignRead = await app.request('/resources/read', {
      method: 'POST',
      headers: { authorization: 'Bearer service-token', 'content-type': 'application/json' },
      body: JSON.stringify({ uri: inputUri, sessionId: 'session-2' })
    })
    expect(foreignRead.status).toBe(403)
    expect((await readJson(foreignRead)).error?.code).toBe('RESOURCE_UNAUTHORIZED')

    // --- a remote host is proxied, and its disconnect is not a local fallback -----------------
    const remoteStore = new VersionedResourceStore({ root: join(root, 'remote-host') })
    const remoteHostRegistry = new ResourceProviderRegistry({ supportedVersions: [1], now: Date.now })
    remoteHostRegistry.register(
      { scheme: 'remote-host', version: 1, capabilities: { read: true, write: true, list: true, watch: true } },
      createSessionScopedStoreProvider({ scheme: 'remote-host', store: remoteStore })
    )
    const remoteUri = 'adr://v1/remote-host/session-1/doc-1?session=session-1'
    await remoteHostRegistry.write(remoteUri, {
      createOnly: true,
      contentType: 'application/pdf',
      stream: (async function * () { yield new Uint8Array(PDF_V1) })()
    }, { authority: { sessionId: 'session-1' }, deadline: Date.now() + 5_000, signal: new AbortController().signal })
    const remoteApp = serviceApp(remoteHostRegistry)

    const remoteRegistry = new ResourceProviderRegistry({ supportedVersions: [1], now: Date.now })
    const reachable = createHttpRemoteResourceTransport({ baseUrl: 'http://remote.invalid', token: 'service-token', fetch: asFetch(remoteApp) })
    remoteRegistry.register({ scheme: 'remote-host', version: 1, capabilities: { read: true, write: true, list: true, watch: false } }, createRemoteResourceProvider(reachable))
    const remoteRead = await remoteRegistry.read(remoteUri, {
      authority: { sessionId: 'session-1', taskId: 'task-1' },
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    })
    const remoteParts: Uint8Array[] = []
    for await (const chunk of remoteRead.stream) remoteParts.push(chunk)
    expect(Buffer.concat(remoteParts).toString()).toBe(PDF_V1.toString())

    const deadRegistry = new ResourceProviderRegistry({ supportedVersions: [1], now: Date.now })
    deadRegistry.register({ scheme: 'remote-host', version: 1, capabilities: { read: true, write: true, list: true, watch: false } }, createRemoteResourceProvider(
      createHttpRemoteResourceTransport({ baseUrl: 'http://remote.invalid', token: 'service-token', fetch: (async () => { throw Object.assign(new Error('socket closed'), { code: 'ECONNREFUSED' }) }) as unknown as typeof fetch })
    ))
    const disconnected = await deadRegistry.read('adr://v1/remote-host/doc-1?session=session-1', {
      authority: { sessionId: 'session-1' },
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    }).then(() => null, (error: ResourceError) => error)
    expect(disconnected?.code).toBe('RESOURCE_UNAVAILABLE')

    // --- concurrent writes based on one version: exactly one commits --------------------------
    const workUri = 'adr://v1/workspace/session-1/notes/brief.txt?session=session-1'
    await first.registry.write(workUri, { createOnly: true, stream: (async function * () { yield new TextEncoder().encode('v1') })() }, {
      authority: { sessionId: 'session-1', taskId: 'task-1' },
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    })
    const writers = ['a', 'b'].map(letter => first.registry.write(workUri, {
      expectedVersion: '1',
      stream: (async function * () { yield new TextEncoder().encode(`v2-${letter}`) })()
    }, {
      authority: { sessionId: 'session-1', taskId: 'task-2' },
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    }))
    const settled = await Promise.allSettled(writers)
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((settled.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('RESOURCE_VERSION_CONFLICT')

    // --- restart: versions, history and the old card survive on disk --------------------------
    first.database.close()
    const second = boot(root)
    const restarted = await second.registry.read(workUri, {
      authority: { sessionId: 'session-1' },
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    })
    const latest: string[] = []
    for await (const chunk of restarted.stream) latest.push(new TextDecoder().decode(chunk))
    expect(latest.join('')).toMatch(/^v2-[ab]$/)

    const history = await second.registry.read(`${workUri}&version=1`, {
      authority: { sessionId: 'session-1' },
      deadline: Date.now() + 5_000,
      signal: new AbortController().signal
    })
    const pinned: string[] = []
    for await (const chunk of history.stream) pinned.push(new TextDecoder().decode(chunk))
    expect(pinned.join('')).toBe('v1')

    const restartedCard = await readJson(await serviceApp(second.registry).request('/resources/read', {
      method: 'POST',
      headers: { authorization: 'Bearer service-token', 'content-type': 'application/json' },
      body: JSON.stringify({ uri: card.uri, taskId: card.taskId, sessionId: card.sessionId })
    }))
    expect(Buffer.from(restartedCard.value!.base64!, 'base64').toString()).toBe(PDF_V1.toString())
    second.database.close()
  })
})
