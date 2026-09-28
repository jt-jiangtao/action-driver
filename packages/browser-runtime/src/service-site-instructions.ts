interface Response {
  frameId: string
  request: { url: string }
  responseHeaders?: { name: string; value: string }[] | undefined
}
export class SiteInstructions {
  instructions = new Map<number, { instruction: string; url: string; frameId: string }>()
  constructor(private proxyEnabled: boolean) {}
  capture(id: number, response: Response) {
    this.clearFrame(id, response.frameId)
    const instruction = response.responseHeaders?.find(
      (header) => header.name.toLowerCase() === 'x-openai-site-instruction'
    )?.value
    if (instruction != null) {
      response.responseHeaders = response.responseHeaders?.filter(
        (header) => header.name.toLowerCase() !== 'x-openai-site-instruction'
      )
      if (!this.proxyEnabled) return
      try {
        const url = new URL(response.request.url),
          host = url.hostname.replace(/\.$/, '')
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          host === 'localhost' ||
          host === 'loopback' ||
          host.endsWith('.localhost') ||
          host === '[::1]' ||
          host.startsWith('127.') ||
          host.startsWith('169.254.') ||
          /^\[fe[89ab][0-9a-f]:/.test(host) ||
          /^\[::ffff:(7f[0-9a-f]{2}|a9fe):/.test(host) ||
          host === 'terminal.local'
        )
          return
        this.instructions.set(id, {
          instruction: decodeURIComponent(instruction),
          url: response.request.url,
          frameId: response.frameId
        })
      } catch {
        this.instructions.delete(id)
      }
    }
  }
  peek(id: number, url: string) {
    const instruction = this.instructions.get(id)
    if (instruction !== undefined && instruction.url === url.split('#', 1)[0])
      return instruction.instruction
  }
  take(id: number, url: string) {
    const instruction = this.peek(id, url)
    this.instructions.delete(id)
    return instruction
  }
  clearFrame(id: number, frameId: string) {
    if (this.instructions.get(id)?.frameId === frameId) this.instructions.delete(id)
  }
  clear(id: number) {
    this.instructions.delete(id)
  }
}
