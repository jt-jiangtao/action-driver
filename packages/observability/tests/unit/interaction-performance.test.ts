import { describe, expect, it } from 'vitest'
import { encodeInteractionPayload } from '../../src/interaction-payload'
import { MemoryInteractionLogStore } from '../../src/interaction-store'

describe('interaction log performance boundaries', () => {
  it('lists 100000 summary records within the interactive budget', async () => {
    const store = new MemoryInteractionLogStore()
    const empty = encodeInteractionPayload({ kind: 'empty' })
    for (let index = 0; index < 100_000; index += 1) {
      await store.begin({
        id: `service:event-${index}`,
        correlationId: `correlation-${index}`,
        time: index,
        transport: index % 2 === 0 ? 'http' : 'ipc',
        direction: 'renderer->service',
        operation: `operation-${index}`,
        request: empty
      })
    }

    const started = performance.now()
    const page = await store.list({ transports: ['http'], limit: 50 })

    expect(page.records).toHaveLength(50)
    expect(page.records.every((record) => record.transport === 'http')).toBe(true)
    expect(performance.now() - started).toBeLessThan(1_000)
  }, 15_000)

  it('keeps the original byte count while truncating text above 4 MiB', () => {
    const text = 'a'.repeat(4 * 1024 * 1024 + 17)
    const encoded = encodeInteractionPayload({ kind: 'text', text })

    expect(encoded.byteLength).toBe(Buffer.byteLength(text))
    expect(encoded.truncated).toBe(true)
    expect(Buffer.byteLength(encoded.text ?? '')).toBe(4 * 1024 * 1024)
  })
})
