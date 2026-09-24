import { createServer, type Server } from 'node:http'
import { once } from 'node:events'

type ToolMode = 'activity' | 'read' | 'shell' | 'shell-timeout' | 'text' | 'web'

export type CapturedToolCompletion = {
  model: string
  stream: boolean
  messages: Array<Record<string, unknown>>
  tools?: Array<{ function?: { name?: string } }>
  tool_choice?: string
}

export class FakeOpenAiToolServer {
  private server: Server | null = null
  private releaseTextStartResponse: (() => void) | null = null
  private releaseTextResponse: (() => void) | null = null
  readonly completions: CapturedToolCompletion[] = []
  baseUrl = ''

  constructor(private readonly mode: ToolMode) {}

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'e2e-tool-model' }] }))
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const completion = JSON.parse(
        Buffer.concat(chunks).toString('utf8')
      ) as CapturedToolCompletion
      this.completions.push(completion)
      const turn = this.completions.length
      if (completion.stream !== true) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'stream must be true' } }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      if (this.mode === 'text') {
        await new Promise<void>((resolve) => {
          this.releaseTextStartResponse = resolve
        })
        response.write(sseChunk({ content: '纯文本' }, null))
        await new Promise<void>((resolve) => {
          this.releaseTextResponse = resolve
        })
        response.write(sseChunk({ content: '回答' }, null))
        response.write(sseChunk({}, 'stop'))
        response.end('data: [DONE]\n\n')
        return
      }
      if (turn === 1 || (this.mode === 'activity' && turn === 2)) {
        const toolName =
          this.mode === 'read' || this.mode === 'activity'
            ? 'sandbox_fs_read'
            : this.mode === 'web'
              ? 'web_search'
              : 'sandbox_shell_run'
        const argumentsJson =
          this.mode === 'read' || this.mode === 'activity'
            ? '{"path":"README.md"}'
            : this.mode === 'web'
              ? '{"query":"ActionDriver","maxResults":1}'
              : this.mode === 'shell-timeout'
                ? '{"command":"rg","args":["needle","BLOCKING_FIFO"]}'
                : '{"command":"rg","args":["needle","README.md"]}'
        const midpoint = Math.ceil(argumentsJson.length / 2)
        if (this.mode === 'activity') {
          response.write(sseChunk({ content: turn === 1 ? '正文 A' : '正文 B' }, null))
        }
        response.write(
          sseChunk(
            {
              tool_calls: [
                {
                  index: 0,
                  id: `provider-tool-${turn}`,
                  type: 'function',
                  function: { name: toolName, arguments: argumentsJson.slice(0, midpoint) }
                }
              ]
            },
            null
          )
        )
        response.write(
          sseChunk(
            {
              tool_calls: [{ index: 0, function: { arguments: argumentsJson.slice(midpoint) } }]
            },
            'tool_calls'
          )
        )
        response.end('data: [DONE]\n\n')
        return
      }
      const toolResult = completion.messages.find((message) => message.role === 'tool')
      const rejected = String(toolResult?.content ?? '').includes('TOOL_REJECTED')
      const timedOut = String(toolResult?.content ?? '').includes('TOOL_TIMEOUT')
      const reply = timedOut
        ? '## 已超时\n\n命令超时，未获得文件内容。'
        : rejected
          ? '## 已拒绝\n\n未执行命令。'
          : this.mode === 'web'
            ? '## 搜索完成\n\n已根据搜索结果完成回答。'
            : '## 已读取\n\n已根据工具结果完成回答。'
      response.write(sseChunk({ content: reply.slice(0, 6) }, null))
      response.write(sseChunk({ content: reply.slice(6) }, null))
      response.write(sseChunk({}, 'stop'))
      response.end('data: [DONE]\n\n')
    })
    this.server.listen(0, '127.0.0.1')
    await once(this.server, 'listening')
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Fake provider did not bind')
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`
  }

  async close(): Promise<void> {
    this.releaseTextStart()
    this.releaseText()
    if (!this.server) return
    const server = this.server
    this.server = null
    server.close()
    await once(server, 'close')
  }

  releaseTextStart(): void {
    this.releaseTextStartResponse?.()
    this.releaseTextStartResponse = null
  }

  releaseText(): void {
    this.releaseTextResponse?.()
    this.releaseTextResponse = null
  }
}

export class FakeSearxngServer {
  private server: Server | null = null
  readonly requests: string[] = []
  endpoint = ''

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      this.requests.push(request.url ?? '')
      if (request.method !== 'GET' || !request.url?.startsWith('/search?')) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          results: [
            {
              title: 'ActionDriver result',
              url: 'https://example.test/actiondriver',
              content: 'A normalized searchable summary',
              engines: ['fake'],
              category: 'general'
            }
          ],
          rawSecret: 'searxng-raw-response-must-not-be-recorded'
        })
      )
    })
    this.server.listen(0, '127.0.0.1')
    await once(this.server, 'listening')
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Fake SearXNG did not bind')
    this.endpoint = `http://127.0.0.1:${address.port}`
  }

  async close(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = null
    server.close()
    await once(server, 'close')
  }
}

function sseChunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-tool-e2e',
    object: 'chat.completion.chunk',
    created: 1_795_000_000,
    model: 'e2e-tool-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`
}
