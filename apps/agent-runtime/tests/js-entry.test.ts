import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsReplHost, type JsReplChild, type JsReplEvents } from '../src/computer-use/js-repl'
import { createSkySession } from '../src/computer-use/sky-session'

// End-to-end over the real child process: JavaScript in, helper requests out.
const serverPath = join(process.cwd(), 'apps/agent-runtime/resources/js-repl/repl-server.mjs')

const tree = {
  ref: 'root', role: 'AXApplication', title: 'TextEdit',
  children: [{ ref: 'field', role: 'AXTextArea', title: 'Draft', actions: ['press'] }]
}

function harness() {
  const requests: Array<Record<string, unknown>> = []
  const host = new JsReplHost({
    spawn: async () => (spawn(process.execPath,
      ['--experimental-vm-modules', '--no-warnings', serverPath],
      { stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as JsReplChild),
    callSky: async (_taskId, method, args) => {
      requests.push({ method, args })
      if (method === 'get_app_state') {
        return { app: 'TextEdit', text: '[0] AXApplication "TextEdit"', screenshot: null }
      }
      if (method === 'list_apps') return [{ id: 'com.apple.TextEdit' }]
      return null
    },
    defaultTimeoutMs: 15_000
  })
  return { host, requests }
}

const events = (): JsReplEvents & { texts: string[]; images: Buffer[] } => {
  const texts: string[] = []
  const images: Buffer[] = []
  return {
    texts, images,
    text: (chunk) => { texts.push(chunk) },
    image: (bytes) => { images.push(bytes) }
  }
}

let host: JsReplHost | undefined
afterEach(() => { host?.disposeAll(); host = undefined })

describe('js entry over the real child process', () => {
  it('bootstraps the documented sky import and answers with the indexed state', async () => {
    const harnessed = harness()
    host = harnessed.host
    const reported = events()
    await host.run('task-1',
      'globalThis.sky = (await import("@oai/sky")).sky;\n' +
      'const state = await sky.get_app_state({ app: "TextEdit" });\n' +
      'nodeRepl.write(state.text);', {}, reported)
    expect(reported.texts.join('')).toContain('[0] AXApplication "TextEdit"')
    expect(harnessed.requests[0]).toMatchObject({ method: 'get_app_state' })
  })

  it('carries bindings into the next call and lets them be redeclared', async () => {
    const harnessed = harness()
    host = harnessed.host
    const reported = events()
    await host.run('task-2', 'const app = "TextEdit"; let count = 1', {}, events())
    await host.run('task-2', 'count += 1; nodeRepl.write(`${app} ${count}`)', {}, reported)
    expect(reported.texts.join('')).toBe('TextEdit 2')
    await host.run('task-2', 'const app = "Notes"; nodeRepl.write(app)', {}, reported)
    expect(reported.texts.join('')).toBe('TextEdit 2Notes')
    // A call that throws keeps the caller's earlier bindings intact.
    await expect(host.run('task-2', 'throw new Error("boom")', {}, events()))
      .rejects.toThrow('boom')
    await host.run('task-2', 'nodeRepl.write(String(count))', {}, reported)
    expect(reported.texts.join('')).toBe('TextEdit 2Notes2')
  })

  it('emits images and rejects top-level static imports like the reference entry', async () => {
    const harnessed = harness()
    host = harnessed.host
    const reported = events()
    await host.run('task-3',
      'await nodeRepl.emitImage({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" })',
      {}, reported)
    expect(Buffer.concat(reported.images)).toEqual(Buffer.from([1, 2, 3]))
    await expect(host.run('task-3', 'import fs from "node:fs"', {}, events()))
      .rejects.toThrow('Top-level static import')
  })

  it('drops bindings on reset while keeping the process', async () => {
    const harnessed = harness()
    host = harnessed.host
    const reported = events()
    await host.run('task-4', 'const kept = 1', {}, events())
    await host.reset('task-4')
    await host.run('task-4', 'nodeRepl.write(String(typeof kept))', {}, reported)
    expect(reported.texts.join('')).toBe('undefined')
  })
})

// Guards the facade contract the child depends on: an index from the rendered state resolves to a
// helper element reference without leaking references into the model's text.
describe('sky facade through the js entry', () => {
  it('resolves element indices from the state the model just read', async () => {
    const requests: Array<Record<string, unknown>> = []
    const sky = createSkySession({
      invoke: async (input) => {
        requests.push(input)
        if (input.operation === 'app-state') {
          return { observationId: 'obs-1', app: 'TextEdit', tree }
        }
        return { executed: true }
      },
      writeScreenshot: async () => 'file:///tmp/shot.jpg'
    })
    const reported = events()
    const entry = new JsReplHost({
      spawn: async () => (spawn(process.execPath,
        ['--experimental-vm-modules', '--no-warnings', serverPath],
        { stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as JsReplChild),
      callSky: async (_taskId, method, args) => await sky.invoke(method, args),
      defaultTimeoutMs: 15_000
    })
    host = entry
    await entry.run('task-5',
      'const { sky: client } = await import("@oai/sky");\n' +
      'const state = await client.get_app_state({ app: "TextEdit" });\n' +
      'nodeRepl.write(state.text);\n' +
      'await client.click({ app: "TextEdit", element_index: 1 });', {}, reported)
    expect(reported.texts.join('')).toBe([
      '[0] AXApplication "TextEdit"',
      '  [1] AXTextArea "Draft" actions=[press]'
    ].join('\n'))
    expect(requests.filter((request) => request.operation === 'act'))
      .toEqual([{ operation: 'act', observationId: 'obs-1',
        action: { type: 'click-element', elementRef: 'field' } }])
    expect(reported.texts.join('')).not.toContain('field')
  })
})

void vi
