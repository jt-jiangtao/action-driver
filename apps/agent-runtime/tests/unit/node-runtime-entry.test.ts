import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

describe('Node Runtime entry', () => {
  it('serves HTTP and WebSocket without Electron and exits on SIGTERM', async () => {
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@actiondriver/agent-runtime',
        'exec',
        'esbuild',
        'src/node-entry.ts',
        '--loader:.md=text',
        '--conditions=development',
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--banner:js=import { createRequire as __actionDriverCreateRequire } from "node:module"; const require = __actionDriverCreateRequire(import.meta.url);',
        '--outfile=dist/node.js',
        '--external:better-sqlite3',
        '--external:electron',
        '--external:ws',
        '--external:jsdom',
        '--external:@mozilla/readability'
      ],
      { cwd: process.cwd(), stdio: 'inherit' }
    )
    const provider = createServer(async (request, response) => {
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      for await (const _chunk of request) {
        /* consume the request body */
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'node reply' }, finish_reason: null }] })}\n\n`
      )
      response.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
      )
      response.end('data: [DONE]\n\n')
    })
    provider.listen(0, '127.0.0.1')
    await once(provider, 'listening')
    const providerAddress = provider.address()
    if (!providerAddress || typeof providerAddress === 'string')
      throw new Error('Fake provider did not bind')
    const child = spawn(process.execPath, [resolve('apps/agent-runtime/dist/node.js')], {
      env: {
        ...process.env,
        ACTIONDRIVER_RUNTIME_DATA_ROOT: mkdtempSync(join(tmpdir(), 'actiondriver-node-')),
        ACTIONDRIVER_WORKSPACE_ROOT: mkdtempSync(join(tmpdir(), 'actiondriver-node-workspace-')),
        ACTIONDRIVER_SERVICE_TOKEN: 'node-smoke-token',
        ACTIONDRIVER_CREDENTIAL_KEY: 'node-smoke-credential-key'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    try {
      const ready = await new Promise<{
        service: { baseUrl: string; streamPath: string; streamProtocol: string }
      }>((done, fail) => {
        let output = ''
        child.once('exit', (code) => fail(new Error(`Node Runtime exited before ready: ${code}`)))
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString()
          const line = output
            .split('\n')
            .find((candidate) => candidate.includes('"type":"runtime.ready"'))
          if (line)
            done(
              JSON.parse(line) as {
                service: { baseUrl: string; streamPath: string; streamProtocol: string }
              }
            )
        })
      })
      const response = await fetch(`${ready.service.baseUrl}/readyz`)
      expect(response.status).toBe(200)
      const configured = await fetch(`${ready.service.baseUrl}/model-connections`, {
        method: 'POST',
        headers: { authorization: 'Bearer node-smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          draft: {
            name: 'Node provider',
            protocol: 'openai-compatible',
            baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
            apiKey: 'sk-node-test'
          },
          models: [{ id: 'node-model', name: 'node-model', enabled: true, testState: 'success' }]
        })
      })
      expect(configured.status).toBe(200)
      const configuredBody = (await configured.json()) as { ok: boolean; value: { id: string } }
      if (!configuredBody.ok) throw new Error(JSON.stringify(configuredBody))
      const socket = new WebSocket(
        `${ready.service.baseUrl.replace('http:', 'ws:')}${ready.service.streamPath}`,
        [ready.service.streamProtocol]
      )
      await new Promise<void>((done, fail) => {
        socket.once('open', done)
        socket.once('error', fail)
      })
      const message = new Promise<Record<string, unknown>>((done) => {
        socket.once('message', (data) =>
          done(JSON.parse(data.toString()) as Record<string, unknown>)
        )
      })
      socket.send(
        JSON.stringify({
          type: 'auth',
          protocol: 'actiondriver.stream.v2',
          eventId: 'node-auth',
          createdAt: new Date().toISOString(),
          payload: { token: 'node-smoke-token' }
        })
      )
      await expect(message).resolves.toMatchObject({ type: 'session.ready' })
      const completion = new Promise<Record<string, unknown>>((done, fail) => {
        socket.on('message', (data) => {
          const event = JSON.parse(data.toString()) as Record<string, unknown>
          if (event.type === 'request.error') fail(new Error(JSON.stringify(event)))
          if (event.type === 'response.end') done(event)
        })
      })
      socket.send(
        JSON.stringify({
          type: 'request.create',
          protocol: 'actiondriver.stream.v2',
          eventId: 'node-create',
          createdAt: new Date().toISOString(),
          requestId: 'node-request',
          idempotencyKey: 'node-key',
          sessionId: null,
          payload: {
            input: { role: 'user', content: 'reply briefly' },
            model: { connectionId: configuredBody.value.id, modelId: 'node-model' },
            skills: []
          }
        })
      )
      await expect(completion).resolves.toMatchObject({ type: 'response.end', status: 'completed' })
      socket.close()
      child.kill('SIGTERM')
      const code = await new Promise<number | null>((done) => child.once('exit', done))
      expect(code).toBe(0)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      provider.close()
      await once(provider, 'close')
    }
  }, 30_000)
})
