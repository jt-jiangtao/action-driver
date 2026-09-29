import { createServer, type Server, type Socket } from 'node:net'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Minimal stand-in for the Computer Use helper so desktop e2e can reach the approval path without
 * macOS Accessibility permissions: it claims the helper socket/token paths inside the run's TMPDIR
 * (the app resolves them with `os.tmpdir()`), answers the app policy, and can hold `app-state` so a
 * request stays inside the approval wait.
 */
export class FakeComputerHelper {
  private server: Server | null = null
  /** Requests seen after the token handshake, for assertions. */
  readonly requests: Array<Record<string, unknown>> = []
  /** `hold` leaves `app-state` unanswered, which keeps the runtime inside the approval wait. */
  stateMode: 'answer' | 'hold' = 'answer'

  constructor(
    private readonly directory: string,
    private readonly token: string
  ) {}

  get socketPath(): string {
    return join(this.directory, 'actiondriver-computer-use.sock')
  }

  get tokenPath(): string {
    return join(this.directory, 'actiondriver-computer-use.token')
  }

  async start(): Promise<void> {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    rmSync(this.socketPath, { force: true })
    writeFileSync(this.tokenPath, `${this.token}\n`, { mode: 0o600 })
    this.server = createServer((socket) => this.serve(socket))
    await new Promise<void>((resolve) => this.server?.listen(this.socketPath, resolve))
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(this.socketPath, { force: true })
  }

  private serve(socket: Socket): void {
    let authenticated = false
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('error', () => undefined)
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          socket.destroy()
          return
        }
        if (!authenticated) {
          authenticated = message.token === this.token
          if (!authenticated) {
            socket.destroy()
            return
          }
          continue
        }
        this.requests.push(message)
        this.respond(socket, message)
      }
    })
  }

  private respond(socket: Socket, request: Record<string, unknown>): void {
    const requestId = String(request.requestId ?? '')
    const reply = (result: unknown) =>
      socket.write(`${JSON.stringify({ version: 1, requestId, ok: true, result })}\n`)
    switch (String(request.operation ?? '')) {
      case 'app-policy':
        reply({
          decision: 'allowed',
          allowPersistentApproval: true,
          target: {
            bundleId: 'com.apple.Notes',
            displayName: 'Notes',
            appPath: '/System/Applications/Notes.app',
            risk: 'low'
          }
        })
        return
      case 'session-start':
        reply({ sessionId: request.sessionId, overlay: false, userInputListening: false })
        return
      case 'session-end':
        reply({ sessionId: request.sessionId, closed: true })
        return
      case 'list-apps':
        reply({ apps: [] })
        return
      case 'permissions':
        reply({
          accessibility: true,
          screenRecording: true,
          eventPosting: true,
          permissionTarget: 'ActionDriver Computer Use'
        })
        return
      case 'app-state':
        if (this.stateMode === 'hold') return
        reply({
          app: 'com.apple.Notes',
          text: '[1] AXWindow "Notes"\n  [2] AXButton "New Note"',
          screenshot: { base64: 'AQID', mimeType: 'image/png' }
        })
        return
      case 'act':
        reply({ executed: true, app: 'com.apple.Notes', pid: 1 })
        return
      default:
        reply({ accepted: true })
    }
  }
}
