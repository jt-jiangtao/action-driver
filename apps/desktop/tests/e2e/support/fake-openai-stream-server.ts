import { createServer, type Server } from 'node:http'
import { once } from 'node:events'

export type CapturedCompletion = {
  model: string
  messages: Array<{ role: string; content: string }>
  stream: boolean
}

export const firstTurnPrompt = '第一轮：请返回两项 Markdown 清单'
export const firstTurnReply = '# 第一轮结果\n\n- Alpha\n- Beta'
export const secondTurnPrompt = '第二轮：请基于上文给出一句总结'
export const secondTurnReply = '# 第二轮结果\n\nAlpha 与 Beta 已汇总完成。'

export class FakeOpenAiStreamServer {
  private server: Server | null = null
  readonly completions: CapturedCompletion[] = []
  baseUrl = ''

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'e2e-stream-model' }] }))
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }

      const body = await readJson(request)
      const captured = body as CapturedCompletion
      if (captured.stream !== true) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'stream must be true' } }))
        return
      }
      this.completions.push({
        model: captured.model,
        messages: captured.messages,
        stream: captured.stream
      })

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      const lastUserMessage = [...captured.messages]
        .reverse()
        .find((message) => message.role === 'user')
      const reply =
        lastUserMessage?.content === firstTurnPrompt
          ? firstTurnReply
          : lastUserMessage?.content === secondTurnPrompt
            ? secondTurnReply
            : '# 未知请求\n\n测试上游未配置此输入。'
      const chunks = splitReply(reply)
      for (const [index, content] of chunks.entries()) {
        response.write(
          `data: ${JSON.stringify({
            id: 'chatcmpl-e2e',
            object: 'chat.completion.chunk',
            created: 1_795_000_000,
            model: 'e2e-stream-model',
            choices: [{ index: 0, delta: { content }, finish_reason: null }]
          })}\n\n`
        )
        await delay(index === 0 ? 650 : 240)
      }
      response.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-e2e',
          object: 'chat.completion.chunk',
          created: 1_795_000_000,
          model: 'e2e-stream-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 }
        })}\n\n`
      )
      response.end('data: [DONE]\n\n')
    })
    this.server.listen(0, '127.0.0.1')
    await once(this.server, 'listening')
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Fake provider did not bind')
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`
  }

  async close(): Promise<void> {
    if (!this.server) return
    const server = this.server
    this.server = null
    server.close()
    await once(server, 'close')
  }
}

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function splitReply(reply: string): string[] {
  const headingEnd = reply.indexOf('\n\n')
  if (headingEnd < 0) return [reply]
  const heading = reply.slice(0, headingEnd)
  const body = reply.slice(headingEnd)
  const bodyMidpoint = Math.max(2, Math.ceil(body.length / 2))
  return [heading, body.slice(0, bodyMidpoint), body.slice(bodyMidpoint)]
}
