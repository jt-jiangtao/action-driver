// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResourceError } from '@action-driver/runtime-contracts'
import { openRuntimeDatabase } from '../../../src/database'
import { SessionWorkspaceStore } from '../../../src/execution/session-workspace'
import { SessionInputFileStore } from '../../../src/media/session-input-file-store'
import { SessionOutputStore } from '../../../src/media/session-output-store'
import { REMOTE_RESOURCE_HOSTS_ENV, createRuntimeResourceRegistryFromStores, parseRemoteResourceHosts } from '../../../src/resources/runtime-resources'
import { createInputFileStore } from '../../../src/persistence/input-file-store'

const temporaryDirectories: string[] = []

function resourceRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'action-driver-resource-root-'))
  temporaryDirectories.push(directory)
  return directory
}

async function text(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(new TextDecoder().decode(chunk))
  return chunks.join('')
}

function context(sessionId: string, taskId?: string) {
  return {
    authority: { sessionId, ...(taskId ? { taskId } : {}) },
    deadline: Date.now() + 5_000,
    signal: new AbortController().signal
  }
}

function createStorage() {
  const directory = mkdtempSync(join(tmpdir(), 'action-driver-runtime-resources-'))
  temporaryDirectories.push(directory)
  const database = openRuntimeDatabase(join(directory, 'action-driver.db'))
  const workspaceRoot = join(directory, 'workspace')
  const workspaces = new SessionWorkspaceStore({ workspaceRoot })
  const inputFiles = new SessionInputFileStore({ database, rootDirectory: directory, workspaces })
  const outputs = new SessionOutputStore({ database, rootDirectory: directory, workspaces })
  const { registry } = createRuntimeResourceRegistryFromStores({
    inputFiles,
    inputFileRecords: createInputFileStore(database).inputFiles,
    outputs,
    resourceRoot: join(directory, 'resources')
  })
  return { directory, database, workspaceRoot, workspaces, inputFiles, outputs, registry }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

const PDF_V1 = Buffer.from('%PDF-1.7\n1 0 obj\n<<v1>>\nendobj\ntrailer\n%%EOF\n')
const PDF_V2 = Buffer.from('%PDF-1.7\n1 0 obj\n<<v2>>\nendobj\ntrailer\n%%EOF\n')

async function writeOutput(workspaceRoot: string, sessionId: string, name: string, bytes: Buffer) {
  const path = join(workspaceRoot, 'sessions', sessionId, 'output', name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
  return path
}

describe('runtime resource registry over the persisted stores', () => {
  it('keeps a historical task deliverable readable after a later task overwrites the same path', async () => {
    const { registry, outputs, workspaceRoot } = createStorage()
    const sessionId = 'session-1'

    const baseline = await outputs.baseline(sessionId)
    writeOutput(workspaceRoot, sessionId, 'report.pdf', PDF_V1)
    const [first] = await outputs.register({
      sessionId,
      taskId: 'task-1',
      files: await outputs.detectChanges(sessionId, baseline)
    })

    const next = await outputs.baseline(sessionId)
    await writeOutput(workspaceRoot, sessionId, 'report.pdf', PDF_V2)
    const [second] = await outputs.register({
      sessionId,
      taskId: 'task-2',
      files: await outputs.detectChanges(sessionId, next)
    })
    expect(first?.fileId).not.toBe(second?.fileId)

    const original = await registry.read(
      `adr://v1/generated-output/${first?.fileId}?task=task-1&session=session-1`,
      context(sessionId, 'task-1')
    )
    expect(await text(original.stream)).toBe(PDF_V1.toString())

    const newer = await registry.read(
      `adr://v1/generated-output/${second?.fileId}?task=task-2&session=session-1`,
      context(sessionId, 'task-2')
    )
    expect(await text(newer.stream)).toBe(PDF_V2.toString())
  })

  it('reads and lists a bound same-session input through its URI', async () => {
    const { registry, inputFiles } = createStorage()
    const sessionId = 'session-1'
    const staged = await inputFiles.stageUpload({ bytes: PDF_V1, name: 'brief.pdf', mimeType: 'application/pdf' })
    await inputFiles.bind(staged.fileId, { sessionId, taskId: 'task-1' })

    const read = await registry.read(
      `adr://v1/session-input/${staged.fileId}?session=session-1`,
      context(sessionId)
    )
    expect(await text(read.stream)).toBe(PDF_V1.toString())
    expect(read.contentType).toBe('application/pdf')

    const listed = await registry.list('adr://v1/session-input/all?session=session-1', context(sessionId))
    expect(listed).toHaveLength(1)
    expect(listed[0]?.immutable).toBe(true)
    expect(listed[0]?.uri).toBe(`adr://v1/session-input/${staged.fileId}?session=session-1`)
  })

  it('refuses cross-session reads of inputs and deliverables without leaking bytes', async () => {
    const { registry, inputFiles, outputs, workspaceRoot } = createStorage()
    const staged = await inputFiles.stageUpload({ bytes: PDF_V1, name: 'brief.pdf', mimeType: 'application/pdf' })
    await inputFiles.bind(staged.fileId, { sessionId: 'session-1', taskId: 'task-1' })

    const baseline = await outputs.baseline('session-1')
    writeOutput(workspaceRoot, 'session-1', 'report.pdf', PDF_V1)
    const [registered] = await outputs.register({
      sessionId: 'session-1',
      taskId: 'task-1',
      files: await outputs.detectChanges('session-1', baseline)
    })

    const scopedInput = await registry
      .read(`adr://v1/session-input/${staged.fileId}?session=session-1`, context('session-2'))
      .then(() => null, (error: ResourceError) => error)
    expect(scopedInput?.code).toBe('RESOURCE_UNAUTHORIZED')

    const scopedOutput = await registry
      .read(
        `adr://v1/generated-output/${registered?.fileId}?task=task-1&session=session-1`,
        context('session-2', 'task-1')
      )
      .then(() => null, (error: ResourceError) => error)
    expect(scopedOutput?.code).toBe('RESOURCE_UNAUTHORIZED')

    // An unscoped URI cannot widen access either: the provider re-checks the persisted owner.
    const unscopedInput = await registry
      .read(`adr://v1/session-input/${staged.fileId}`, context('session-2'))
      .then(() => null, (error: ResourceError) => error)
    expect(unscopedInput?.code).toBe('RESOURCE_NOT_FOUND')

    const crossSessionList = await registry
      .list('adr://v1/session-input/all', context('session-2'))
      .then((entries) => entries.length)
    expect(crossSessionList).toBe(0)
  })
})

describe('remote resource host configuration', () => {
  it('registers each declared host by scheme and keeps the URI scheme authoritative', async () => {
    const registrations = parseRemoteResourceHosts({
      [REMOTE_RESOURCE_HOSTS_ENV]: JSON.stringify([{ scheme: 'remote-host', baseUrl: 'http://127.0.0.1:4321', token: 'secret' }])
    })
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.descriptor).toEqual({ scheme: 'remote-host', version: 1 })

    const { registry } = createRuntimeResourceRegistryFromStores({
      inputFiles: { read: async () => { throw new Error('unused') } },
      inputFileRecords: { listBySession: async () => [] },
      outputs: { readSnapshot: async () => { throw new Error('unused') }, listByTask: async () => [] },
      resourceRoot: join(resourceRoot(), 'resources'),
      remote: registrations
    })
    expect(registry.descriptors().map(descriptor => descriptor.scheme).sort()).toEqual(['generated-output', 'plugin', 'remote-host', 'session-input', 'workspace'])
    // The HTTP surface advertises no push channel, so a remote watch is a capability error, not a
    // broken stream.
    const watched = await registry
      .watch('adr://v1/remote-host/doc-1?session=session-1', { authority: { sessionId: 'session-1' }, deadline: Date.now() + 1_000, signal: new AbortController().signal })
      .then(() => null, (error: ResourceError) => error)
    expect(watched?.code).toBe('RESOURCE_UNSUPPORTED')
  })

  it('rejects a malformed remote declaration instead of silently dropping the host', () => {
    expect(() => parseRemoteResourceHosts({ [REMOTE_RESOURCE_HOSTS_ENV]: 'not json' })).toThrow(/valid JSON/)
    expect(() => parseRemoteResourceHosts({ [REMOTE_RESOURCE_HOSTS_ENV]: JSON.stringify([{ scheme: 'Remote Host', baseUrl: 'http://x', token: 't' }]) })).toThrow(/invalid scheme/)
    expect(() => parseRemoteResourceHosts({ [REMOTE_RESOURCE_HOSTS_ENV]: JSON.stringify([{ scheme: 'remote-host', baseUrl: 'file:///etc', token: 't' }]) })).toThrow(/baseUrl/)
    expect(() => parseRemoteResourceHosts({ [REMOTE_RESOURCE_HOSTS_ENV]: JSON.stringify([{ scheme: 'remote-host', baseUrl: 'http://x' }]) })).toThrow(/token/)
    expect(parseRemoteResourceHosts({})).toEqual([])
  })
})
