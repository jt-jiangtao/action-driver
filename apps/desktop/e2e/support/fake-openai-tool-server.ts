import { createServer, type Server } from 'node:http'
import { once } from 'node:events'

type ToolMode =
  | 'activity'
  | 'read'
  | 'shell'
  | 'shell-timeout'
  | 'python'
  | 'python-blocking'
  | 'node'
  | 'computer-approval'
  | 'browser-computer'
  | 'browser-embedded'
  | 'triple'
  | 'text'
  | 'tool-preparing'
  | 'sandbox'
  | 'sandbox-escape'
  | 'office'
  | 'office-soffice'
  | 'deliverable'
  | 'image'
  | 'image-partial'
  | 'image-cancel'
  | 'image-replay'
  | 'vision'
  | 'vision-rejected'

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
  private releaseToolResponse: (() => void) | null = null
  readonly completions: CapturedToolCompletion[] = []
  readonly imageGenerations: Array<{ model: string; prompt: string; n: number }> = []
  readonly imageCompletions: string[] = []
  baseUrl = ''
  browserTargetUrl = ''
  browserTargetBrowserId: 'iab' | 'chrome' = 'iab'

  constructor(private mode: ToolMode) {}

  setMode(mode: ToolMode): void {
    this.mode = mode
    this.completions.length = 0
    this.imageGenerations.length = 0
    this.imageCompletions.length = 0
  }

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'e2e-tool-model' }] }))
        return
      }
      if (request.method === 'POST' && request.url === '/v1/images/generations') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          model: string
          prompt: string
          n: number
        }
        const index = this.imageGenerations.push(input) - 1
        await new Promise<void>((resolve) => {
          const timer = setTimeout(
            resolve,
            this.mode === 'image-cancel' && index > 0
              ? 8_000
              : this.mode === 'image-replay' && index > 0
                ? 1_500
                : ([280, 40, 190, 120][index] ?? 40)
          )
          response.once('close', () => {
            clearTimeout(timer)
            resolve()
          })
        })
        if (response.destroyed) return
        if (this.mode === 'image-partial' && input.prompt === 'fail') {
          response
            .writeHead(429, { 'content-type': 'application/json' })
            .end('{"error":"rate-limited"}')
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            data: [
              {
                b64_json:
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII='
              }
            ]
          })
        )
        this.imageCompletions.push(input.prompt)
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
      if (this.mode === 'vision-rejected') {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Unexpected item type in content.' } }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      if (this.mode === 'vision') {
        response.write(sseChunk({ content: '识别到了图片' }, null))
        response.write(sseChunk({}, 'stop'))
        response.end('data: [DONE]\n\n')
        return
      }
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
      if (
        turn === 1 ||
        (this.mode === 'activity' && turn === 2) ||
        (this.mode === 'triple' && turn <= 3) ||
        (this.mode === 'computer-approval' && turn === 2) ||
        (this.mode === 'browser-embedded' && turn === 2) ||
        (this.mode === 'browser-computer' && turn <= 3)
      ) {
        if (
          this.mode === 'image' ||
          this.mode === 'image-partial' ||
          this.mode === 'image-cancel' ||
          this.mode === 'image-replay'
        ) {
          const prompts =
            this.mode === 'image-partial'
              ? ['one', 'two', 'fail', 'four']
              : ['one', 'two', 'three', 'four']
          response.write(
            sseChunk(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: 'provider-image-1',
                    type: 'function',
                    function: {
                      name: 'tools_local_image_generation_generate',
                      arguments: JSON.stringify({ images: prompts.map((prompt) => ({ prompt })) })
                    }
                  }
                ]
              },
              'tool_calls'
            )
          )
          response.end('data: [DONE]\n\n')
          return
        }
        const toolMode =
          this.mode === 'triple'
            ? turn === 1
              ? 'python'
              : turn === 2
                ? 'node'
                : 'shell'
            : this.mode
        const toolName =
          toolMode === 'read' || toolMode === 'activity'
            ? 'tools_local_command_shell_run'
            : toolMode === 'sandbox' || toolMode === 'sandbox-escape'
              ? 'tools_local_command_python_run'
            : toolMode === 'deliverable'
              ? 'tools_local_command_shell_run'
                : toolMode === 'python' || toolMode === 'python-blocking'
                  ? 'tools_local_command_python_run'
                  : toolMode === 'node'
                    ? 'tools_local_command_node_run'
                    : 'tools_local_command_shell_run'
        const argumentsJson =
          toolMode === 'read' || toolMode === 'activity'
            ? '{"script":"mkdir -p output && printf \'E2E workspace\\n\' > output/README.md && cat output/README.md"}'
            : toolMode === 'sandbox'
              ? '{"script":"import json, os\\nprint(json.dumps({\\"cwd\\": os.getcwd(), \\"inherited\\": sorted(key for key in os.environ if key.startswith(\\"ACTIONDRIVER\\"))}))"}'
              : toolMode === 'sandbox-escape'
                ? '{"script":"import pathlib\\nprint(pathlib.Path(\'../../README.md\').read_text())"}'
                : toolMode === 'office'
                  ? '{"script":"{ echo \\"RUNTIME_PYTHON=$RUNTIME_PYTHON\\"; \\"$RUNTIME_PYTHON\\" -c \'import docx, reportlab, pdfplumber, pypdf; print(\\"office-python-ok\\")\'; } > output/office-diag.txt 2>&1; cat output/office-diag.txt"}'
                  : toolMode === 'office-soffice'
                    ? '{"script":"{ echo \\"RUNTIME_BIN_DIR=$RUNTIME_BIN_DIR\\"; ls \\"$RUNTIME_BIN_DIR\\"; \\"$RUNTIME_BIN_DIR\\"/soffice --version; } > output/soffice-diag.txt 2>&1; cat output/soffice-diag.txt"}'
                    : toolMode === 'deliverable'
                      ? '{"script":"mkdir -p output && printf \'%%PDF-1.7\\n%%EOF\\n\' > output/report.pdf && printf \'%%PDF-1.7\\n%%EOF\\n\' > output/summary.pdf && echo deliverable-written"}'
                    : toolMode === 'python'
                      ? '{"script":"import json,sys; print(json.dumps({\\"executable\\":sys.executable}))"}'
                      : toolMode === 'python-blocking'
                        ? '{"script":"import time; time.sleep(60)"}'
                        : toolMode === 'node'
                          ? '{"script":"console.log(JSON.stringify({executable:process.execPath}))"}'
                          : toolMode === 'shell-timeout'
                            ? '{"script":"sleep 12"}'
                            : '{"script":"mkdir -p output && printf \'needle is present\\n\' > output/README.md && rg needle output/README.md"}'
        // Read the skill before the Computer Use call, matching the production skill gate.
        const resolvedToolName = toolMode === 'browser-computer'
          ? turn <= 2 ? 'tools_local_skills_read' : 'tools_local_cua_js'
          : toolMode === 'computer-approval'
          ? turn === 1 ? 'tools_local_skills_read' : 'tools_local_cua_js'
          : toolMode === 'browser-embedded'
            ? turn === 1 ? 'tools_local_skills_read' : 'tools_local_cua_js'
            : toolName
        const resolvedArguments = toolMode === 'browser-computer'
          ? turn === 1 ? '{"skillId":"browser-use"}'
            : turn === 2 ? '{"skillId":"computer-use"}'
              : JSON.stringify({ title: '查看网页并操作备忘录',
                code: `const tab=await cua.createBrowserTab("iab", ${JSON.stringify(this.browserTargetUrl)}); await cua.getApp("Notes")` })
          : toolMode === 'computer-approval'
          ? turn === 1 ? '{"skillId":"computer-use"}'
            : '{"code":"await cua.getApp(\\"Notes\\")"}'
          : toolMode === 'browser-embedded'
            ? turn === 1 ? '{"skillId":"browser-use"}'
              : JSON.stringify({ title: this.browserTargetBrowserId === 'iab'
                ? '打开内置浏览器' : '打开独立 Chrome',
                code: `await cua.createBrowserTab(${JSON.stringify(this.browserTargetBrowserId)}, ${JSON.stringify(this.browserTargetUrl)})` })
          : argumentsJson
        const midpoint = Math.ceil(resolvedArguments.length / 2)
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
                  function: { name: resolvedToolName, arguments: resolvedArguments.slice(0, midpoint) }
                }
              ]
            },
            null
          )
        )
        if (this.mode === 'tool-preparing') {
          await new Promise<void>((resolve) => {
            this.releaseToolResponse = resolve
          })
        }
        response.write(
          sseChunk(
            {
              tool_calls: [{ index: 0, function: { arguments: resolvedArguments.slice(midpoint) } }]
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
          : this.mode === 'image' ||
              this.mode === 'image-partial' ||
              this.mode === 'image-cancel' ||
              this.mode === 'image-replay'
            ? '图片已生成'
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
    this.releaseTool()
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

  releaseTool(): void {
    this.releaseToolResponse?.()
    this.releaseToolResponse = null
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
