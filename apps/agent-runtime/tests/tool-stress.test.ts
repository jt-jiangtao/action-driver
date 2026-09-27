import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolExecutionContext, ToolExecutor } from '@actiondriver/runtime-contracts'
import { createScriptTools } from '../src/execution/tools'
import { createSearxngSearchTool } from '../src/searxng/search-tool'

const stress = process.env.ACTIONDRIVER_STRESS_TOOLS === '1' ? it : it.skip

async function execute(
  executor: ToolExecutor,
  modelName: string,
  index: number,
  input: ToolCall['arguments'],
  context?: ToolExecutionContext
) {
  const call: ToolCall = {
    callId: `${modelName}-${index}`,
    providerCallId: `provider-${modelName}-${index}`,
    modelName,
    arguments: input
  }
  const events = []
  for await (const event of executor.execute(call, undefined, context)) events.push(event)
  return events
}

describe('explicit 100 calls per tool stress verification', () => {
  stress(
    'executes Shell, bundled Python, bundled Node, and HTTP Web Search 100 times each',
    async () => {
      const workspaceRoot = await mkdtemp(join(tmpdir(), 'actiondriver-tool-stress-'))
      const requests: string[] = []
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        requests.push(url.searchParams.get('q') ?? '')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            results: [
              {
                title: url.searchParams.get('q'),
                url: `https://example.test/result/${requests.length}`,
                content: 'search result',
                engines: ['local-test']
              }
            ]
          })
        )
      })
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      try {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('missing test server port')
        const tools = await createScriptTools({
          runtimeDist: join(process.cwd(), 'apps/agent-runtime/dist')
        })
        const executionContext: ToolExecutionContext = {
          taskId: 'stress-task',
          sessionId: 'stress-session',
          workspace: {
            root: workspaceRoot,
            input: join(workspaceRoot, 'input'),
            output: join(workspaceRoot, 'output')
          }
        }
        const search = createSearxngSearchTool({ endpoint: `http://127.0.0.1:${address.port}` })
        const cases = [
          {
            name: 'tools_local_command_shell_run',
            executor: tools[0]!.executor,
            input: (i: number) => ({ command: `printf stress-${i}` })
          },
          {
            name: 'tools_local_command_python_run',
            executor: tools[1]!.executor,
            input: (i: number) => ({ code: `print("stress-${i}")` })
          },
          {
            name: 'tools_local_command_node_run',
            executor: tools[2]!.executor,
            input: (i: number) => ({ code: `console.log("stress-${i}")` })
          },
          {
            name: 'tools_local_web_search',
            executor: search.executor,
            input: (i: number) => ({ query: `stress-${i}` })
          }
        ]
        const successes = new Map<string, number>()
        for (const testCase of cases) {
          for (let index = 0; index < 100; index += 1) {
            const events = await execute(
              testCase.executor,
              testCase.name,
              index,
              testCase.input(index),
              executionContext
            )
            expect(JSON.stringify(events)).toContain(`stress-${index}`)
            expect(events.at(-1)).toMatchObject({ kind: 'result' })
            successes.set(testCase.name, (successes.get(testCase.name) ?? 0) + 1)
          }
        }
        expect(Object.fromEntries(successes)).toEqual({
          tools_local_command_shell_run: 100,
          tools_local_command_python_run: 100,
          tools_local_command_node_run: 100,
          tools_local_web_search: 100
        })
        expect(requests).toHaveLength(100)
      } finally {
        server.close()
        await once(server, 'close')
        await rm(workspaceRoot, { recursive: true, force: true })
      }
    },
    120_000
  )
})
