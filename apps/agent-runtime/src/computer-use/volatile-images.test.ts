import { describe, expect, it } from 'vitest'
import { VolatileComputerImages } from './volatile-images'

describe('VolatileComputerImages', () => {
  it('assembles bounded chunks and returns a short lived handle', () => {
    let now = 1000
    const store = new VolatileComputerImages({ now: () => now, ttlMs: 50 })
    const bytes = Buffer.from('image bytes')
    store.begin('one', { mimeType: 'image/jpeg', width: 10, height: 5, byteLength: bytes.length })
    store.chunk('one', 0, bytes.subarray(0, 4).toString('base64'))
    store.chunk('one', 1, bytes.subarray(4).toString('base64'))
    const asset = store.finish('one')
    expect(asset.assetId).toMatch(/^volatile-computer:/)
    expect(store.read(asset).bytes).toEqual(bytes)
    now = 1051
    expect(() => store.read(asset)).toThrow('SCREENSHOT_EXPIRED')
  })

  it('rejects overlarge and out of order chunks', () => {
    const store = new VolatileComputerImages({ maxBytes: 4 })
    expect(() => store.begin('bad', { mimeType: 'image/jpeg', width: 1, height: 1, byteLength: 5 }))
      .toThrow('SCREENSHOT_TOO_LARGE')
    store.begin('good', { mimeType: 'image/jpeg', width: 1, height: 1, byteLength: 4 })
    expect(() => store.chunk('good', 1, Buffer.from('test').toString('base64')))
      .toThrow('SCREENSHOT_CHUNK_INVALID')
  })
})
