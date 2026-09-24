import { EXTERNAL_LINK_OPEN_CHANNEL } from '../shared/external-link-contract'

export function registerExternalLinkIpc(
  ipc: {
    handle(channel: string, handler: (_event: unknown, input: unknown) => Promise<void>): void
  },
  openExternal: (url: string) => Promise<unknown>
): void {
  ipc.handle(EXTERNAL_LINK_OPEN_CHANNEL, async (_event, input) => {
    if (typeof input !== 'string' || input.length > 2_048) throw new Error('EXTERNAL_LINK_INVALID')
    let url: URL
    try {
      url = new URL(input)
    } catch {
      throw new Error('EXTERNAL_LINK_INVALID')
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
      throw new Error('EXTERNAL_LINK_INVALID')
    await openExternal(url.href)
  })
}
