import { describe, expect, it } from 'vitest'
import { nextPartOrder, sortPartsByOrder, type MessageContentPart } from '@action-driver/contracts'

const batch = (callId: string, imageCount = 4, order = 1): MessageContentPart => ({
  kind: 'image-batch',
  callId,
  imageCount,
  order
})
const image = (callId: string, index: number, order: number): MessageContentPart => ({
  kind: 'image',
  asset: {
    assetId: `${callId}-${index}`,
    sessionId: 'session-1',
    mimeType: 'image/png',
    width: 1,
    height: 1,
    byteLength: 20,
    source: 'generated'
  },
  generation: { callId, index },
  order
})
const text = (value: string, order: number): MessageContentPart => ({
  kind: 'text',
  text: value,
  order
})

describe('transcript order contract', () => {
  it('reserves one order per image so a batch keeps its place while text streams', () => {
    // A 4-image batch at order 1 owns orders 2..5, so the answer that the model
    // streams while the pictures are still rendering comes after all of them.
    expect(nextPartOrder([text('过程', 0), batch('call-1', 4, 1)])).toBe(6)
  })

  it('sorts parts by order and keeps unordered legacy parts in place', () => {
    expect(
      sortPartsByOrder([image('call-1', 3, 5), text('过程', 0), image('call-1', 0, 2)]).map((part) =>
        part.kind === 'text' ? 'text' : part.kind === 'image' ? `image:${part.generation?.index}` : part.kind
      )
    ).toEqual(['text', 'image:0', 'image:3'])
    const legacy: MessageContentPart[] = [{ kind: 'text', text: '旧' }, { kind: 'image', asset: {
      assetId: 'a', sessionId: 's', mimeType: 'image/png', width: 1, height: 1, byteLength: 1, source: 'generated'
    } }]
    expect(sortPartsByOrder(legacy)).toEqual(legacy)
  })
})
