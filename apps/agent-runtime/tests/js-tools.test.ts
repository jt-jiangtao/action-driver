import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolCall, ToolExecutionContext, ToolExecutorEvent } from '@actiondriver/runtime-contracts'
import { createJsEntryTools } from '../src/computer-use/js-tools'

const runtimeDist = join(process.cwd(), 'apps/agent-runtime/dist')

async function sessionWorkspaceRoot(prefix: string): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(workspaceRoot, 'sessions', 'session-1', 'input'), { recursive: true })
  await mkdir(join(workspaceRoot, 'sessions', 'session-1', 'output'), { recursive: true })
  return workspaceRoot
}

function context(workspaceRoot: string): ToolExecutionContext {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    workspace: {
      root: join(workspaceRoot, 'sessions', 'session-1'),
      input: join(workspaceRoot, 'sessions', 'session-1', 'input'),
      output: join(workspaceRoot, 'sessions', 'session-1', 'output')
    }
  }
}

function entry(overrides: {
  invokeComputer?: (input: Record<string, unknown>) => Promise<unknown>
  skillLoaded?: (taskId: string) => boolean
} = {}) {
  return createJsEntryTools({
    runtimeDist,
    invokeComputer: overrides.invokeComputer ?? (async () => ({})),
    saveImage: async (_sessionId, bytes) => ({
      assetId: 'volatile-computer:test', sessionId: 'session-1', source: 'upload',
      mimeType: 'image/png', width: 1, height: 1, byteLength: bytes.byteLength
    }),
    ...(overrides.skillLoaded ? { skillLoaded: overrides.skillLoaded } : {})
  })
}

async function run(
  tools: ReturnType<typeof entry>['tools'],
  modelName: 'js' | 'js_reset',
  args: Record<string, unknown>,
  workspaceRoot: string,
  continuation?: { decisions: Array<{ actionIndex: number; approved: boolean }> }
): Promise<ToolExecutorEvent[]> {
  const tool = tools.find((candidate) => candidate.definition.modelName === modelName)!
  const call: ToolCall = {
    callId: 'test', providerCallId: 'provider-test', modelName,
    arguments: args as ToolCall['arguments']
  }
  const events: ToolExecutorEvent[] = []
  const execution = { ...context(workspaceRoot),
    ...(continuation ? { continuation } : {}) }
  for await (const event of tool.executor.execute(call, undefined, execution)) {
    events.push(event)
  }
  return events
}

const output = (events: ToolExecutorEvent[]): unknown =>
  events.filter((event) => event.kind === 'result')
    .map((event) => (event as { output: unknown }).output).at(-1)

describe('js entry tools', () => {
  it('runs a cell inside the session workspace and returns what it wrote', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('actiondriver-js-')
    const tools = entry()
    const events = await run(tools.tools, 'js', {
      code: 'const fs = await import("node:fs/promises");\n' +
        'await fs.writeFile("output/note.txt", "hello");\n' +
        'nodeRepl.write(`${nodeRepl.cwd} ${await fs.readFile("output/note.txt", "utf8")}`);'
    }, workspaceRoot)
    const text = events.filter((event) => event.kind === 'content')
      .map((event) => (event as { delta: string }).delta).join('')
    expect(text).toContain('sessions/session-1 hello')
    expect(output(events)).toEqual({ output: text })
    tools.dispose()
  })

  it('keeps bindings between calls and drops them on js_reset', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('actiondriver-js-')
    const tools = entry()
    await run(tools.tools, 'js', { code: 'const counter = 41' }, workspaceRoot)
    const bumped = await run(tools.tools, 'js',
      { code: 'nodeRepl.write(String(counter + 1))' }, workspaceRoot)
    expect(output(bumped)).toEqual({ output: '42' })
    await run(tools.tools, 'js_reset', {}, workspaceRoot)
    const cleared = await run(tools.tools, 'js',
      { code: 'nodeRepl.write(String(typeof counter))' }, workspaceRoot)
    expect(output(cleared)).toEqual({ output: 'undefined' })
    tools.dispose()
  })

  it('routes sky calls to the native provider and turns images into assets', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('actiondriver-js-')
    const requests: Array<Record<string, unknown>> = []
    const tools = entry({
      invokeComputer: async (input) => {
        requests.push(input)
        if (input.operation === 'list-apps') return { apps: [{ id: 'com.apple.TextEdit' }] }
        return {}
      }
    })
    const events = await run(tools.tools, 'js', {
      code: 'const { sky } = await import("@oai/sky");\n' +
        'const apps = await sky.list_apps();\n' +
        'nodeRepl.write(JSON.stringify(apps));\n' +
        'await nodeRepl.emitImage({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });'
    }, workspaceRoot)
    expect(requests).toEqual([{ operation: 'list-apps' }])
    expect(output(events)).toEqual({ output: '[{"id":"com.apple.TextEdit"}]' })
    expect(events.filter((event) => event.kind === 'asset')).toEqual([
      { kind: 'asset', index: 0, asset: {
        assetId: 'volatile-computer:test', sessionId: 'session-1', source: 'upload',
        mimeType: 'image/png', width: 1, height: 1, byteLength: 3
      } }
    ])
    tools.dispose()
  })

  it('refuses to run before the computer-use Skill was read', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('actiondriver-js-')
    const tools = entry({ skillLoaded: () => false })
    await expect(run(tools.tools, 'js', { code: 'nodeRepl.write("hi")' }, workspaceRoot))
      .rejects.toThrow('SKILL_NOT_LOADED')
    tools.dispose()
  })

  it('keeps the sandbox: reads outside the session workspace fail', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('actiondriver-js-')
    const outside = await mkdtemp(join(tmpdir(), 'actiondriver-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    const tools = entry()
    await expect(run(tools.tools, 'js', {
      code: 'const fs = await import("node:fs/promises");\n' +
        `nodeRepl.write(await fs.readFile(${JSON.stringify(join(outside, 'secret.txt'))}, "utf8"));`
    }, workspaceRoot)).rejects.toThrow(/EPERM|EACCES/)
    tools.dispose()
  })

  it('validates the tool arguments', async () => {
    const workspaceRoot = await sessionWorkspaceRoot('actiondriver-js-')
    const tools = entry()
    await expect(run(tools.tools, 'js', { code: '  ' }, workspaceRoot))
      .rejects.toThrow('TOOL_INPUT_INVALID')
    await expect(run(tools.tools, 'js', { code: 'nodeRepl.write("hi")', timeout_ms: 10 }, workspaceRoot))
      .rejects.toThrow('TOOL_INPUT_INVALID')
    tools.dispose()
  })

})
