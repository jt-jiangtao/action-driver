import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocalInteractionLogStore } from './local-interaction-store'
import type { InteractionLogStore, InteractionPayloadView } from './interaction-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

async function createStore(
  source = 'main',
  retention?: { maxTotalBytes: number; maxAgeMs: number; maxTextPayloadBytes: number },
  clock: () => number = () => 2_000
) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'actiondriver-interactions-'))
  directories.push(rootDirectory)
  const store = await createLocalInteractionLogStore({
    rootDirectory,
    source,
    clock,
    ...(retention ? { retention } : {})
  })
  return { rootDirectory, store }
}

function payload(text: string): InteractionPayloadView {
  return {
    kind: 'text',
    contentType: 'text/plain',
    byteLength: Buffer.byteLength(text),
    truncated: false,
    text,
    unavailableReason: null
  }
}

async function seedCompleted(
  store: InteractionLogStore,
  id: string,
  time: number,
  text = 'request'
) {
  await store.begin({
    id,
    correlationId: `correlation-${id}`,
    time,
    transport: 'ipc',
    direction: 'renderer->service',
    operation: `operation-${id}`,
    request: payload(text)
  })
  await store.complete(id, {
    completedAt: time + 5,
    outcome: 'ok',
    response: payload(`response-${id}`)
  })
}

describe('local interaction log store', () => {
  it('lists summaries without depending on payload files and loads one detail lazily', async () => {
    const { rootDirectory, store } = await createStore()
    await seedCompleted(store, 'main:event-1', 1_000)
    const payloadDirectory = join(rootDirectory, 'main', 'payloads')
    const files = await readdir(payloadDirectory)

    expect((await store.list({ transports: ['ipc'], limit: 20 })).records).toHaveLength(1)
    expect((await store.getDetail('main:event-1'))?.request?.text).toBe('request')

    await unlink(join(payloadDirectory, files.find((file) => file.includes('.request.'))!))
    expect((await store.list({ limit: 20 })).records).toHaveLength(1)
    expect((await store.getDetail('main:event-1'))?.request).toMatchObject({
      text: null,
      unavailableReason: 'missing'
    })
  })

  it('keeps source namespaces isolated under a shared root', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'actiondriver-interactions-'))
    directories.push(rootDirectory)
    const main = await createLocalInteractionLogStore({
      rootDirectory,
      source: 'main',
      clock: () => 2_000
    })
    const service = await createLocalInteractionLogStore({
      rootDirectory,
      source: 'service',
      clock: () => 2_000
    })
    await seedCompleted(main, 'main:event-1', 1_000)
    await seedCompleted(service, 'service:event-1', 1_001)

    expect((await main.list({ limit: 20 })).records.map((record) => record.id)).toEqual([
      'main:event-1'
    ])
    expect((await service.list({ limit: 20 })).records.map((record) => record.id)).toEqual([
      'service:event-1'
    ])
  })

  it('recovers stale pending records and ignores a corrupt index line', async () => {
    const { rootDirectory, store } = await createStore()
    await store.begin({
      id: 'main:pending',
      correlationId: 'correlation-pending',
      time: 1_000,
      transport: 'http',
      direction: 'renderer->service',
      operation: 'POST /tasks',
      request: payload('start')
    })
    await appendFile(join(rootDirectory, 'main', 'index.ndjson'), '{broken}\n')

    const restarted = await createLocalInteractionLogStore({
      rootDirectory,
      source: 'main',
      clock: () => 2_000
    })
    expect(await restarted.recoverIncomplete(1_001)).toBe(0)
    expect((await restarted.list({ limit: 20 })).records[0]?.state).toBe('incomplete')
  })

  it('preserves the reason when a payload cannot be persisted safely', async () => {
    const { store } = await createStore()
    await store.begin({
      id: 'main:unsafe',
      correlationId: 'correlation-unsafe',
      time: 1_000,
      transport: 'ipc',
      direction: 'renderer->service',
      operation: 'unsafe',
      request: {
        kind: 'json',
        contentType: 'application/json',
        byteLength: 0,
        truncated: false,
        text: null,
        unavailableReason: 'unsafe-to-persist'
      }
    })

    expect(await store.getDetail('main:unsafe')).toMatchObject({
      requestAvailable: false,
      request: { unavailableReason: 'unsafe-to-persist' }
    })
  })

  it('prunes oldest events by age and rewrites summaries with their payloads', async () => {
    const { rootDirectory, store } = await createStore(
      'main',
      {
        maxTotalBytes: 10_000,
        maxAgeMs: 100,
        maxTextPayloadBytes: 4_194_304
      },
      () => 1_050
    )
    await seedCompleted(store, 'main:old', 1_000)
    await seedCompleted(store, 'main:current', 1_950)

    expect(await store.prune(2_000)).toMatchObject({ removedEvents: 1 })
    expect((await store.list({ limit: 20 })).records.map((record) => record.id)).toEqual([
      'main:current'
    ])
    expect(await store.getDetail('main:old')).toBeNull()
    expect(await readFile(join(rootDirectory, 'main', 'index.ndjson'), 'utf8')).not.toContain(
      'main:old'
    )
  })

  it('automatically prunes after a completed write and removes orphan temporary files', async () => {
    let now = 1_050
    const retention = {
      maxTotalBytes: 10_000,
      maxAgeMs: 100,
      maxTextPayloadBytes: 4_194_304
    }
    const { rootDirectory, store } = await createStore('main', retention, () => now)
    await seedCompleted(store, 'main:old', 1_000)

    const payloadDirectory = join(rootDirectory, 'main', 'payloads')
    await mkdir(payloadDirectory, { recursive: true })
    await writeFile(join(payloadDirectory, 'orphan.tmp'), 'partial')
    await writeFile(join(payloadDirectory, 'orphan.request.json.gz'), 'unreferenced')
    now = 2_000
    await seedCompleted(store, 'main:current', 1_950)

    expect((await store.list({ limit: 20 })).records.map((record) => record.id)).toEqual([
      'main:current'
    ])

    const restarted = await createLocalInteractionLogStore({
      rootDirectory,
      source: 'main',
      retention,
      clock: () => now
    })
    expect(await readdir(payloadDirectory)).not.toContain('orphan.tmp')
    expect(await readdir(payloadDirectory)).not.toContain('orphan.request.json.gz')
    expect((await restarted.list({ limit: 20 })).records.map((record) => record.id)).toEqual([
      'main:current'
    ])
  })

  it('compacts the append-only index while pruning instead of deleting every event', async () => {
    const { rootDirectory, store } = await createStore('main', {
      maxTotalBytes: 2_000,
      maxAgeMs: 10_000,
      maxTextPayloadBytes: 4_194_304
    })
    await seedCompleted(store, 'main:first', 1_000, '')
    await seedCompleted(store, 'main:second', 1_001, '')
    await seedCompleted(store, 'main:third', 1_002, '')

    const records = (await store.list({ limit: 20 })).records
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]?.id).toBe('main:third')
    const indexLines = (await readFile(join(rootDirectory, 'main', 'index.ndjson'), 'utf8'))
      .split('\n')
      .filter(Boolean)
    expect(indexLines).toHaveLength(records.length)
  })
})
