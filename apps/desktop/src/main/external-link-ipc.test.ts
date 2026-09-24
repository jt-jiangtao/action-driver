import { describe, expect, it, vi } from 'vitest'
import { registerExternalLinkIpc } from './external-link-ipc'
import { EXTERNAL_LINK_OPEN_CHANNEL } from '../shared/external-link-contract'

describe('external source links', () => {
  it('opens only validated HTTP(S) links through the system browser', async () => {
    let handler: ((_event: unknown, input: unknown) => Promise<void>) | undefined
    const openExternal = vi.fn(async () => {})
    registerExternalLinkIpc(
      {
        handle(channel, callback) {
          expect(channel).toBe(EXTERNAL_LINK_OPEN_CHANNEL)
          handler = callback
        }
      },
      openExternal
    )
    await handler?.({}, 'https://example.com/story')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/story')
    for (const url of [
      'file:///tmp/secret',
      'javascript:alert(1)',
      'https://u:p@example.com',
      'bad'
    ]) {
      await expect(handler?.({}, url)).rejects.toThrow('EXTERNAL_LINK_INVALID')
    }
    expect(openExternal).toHaveBeenCalledTimes(1)
  })
})
