import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { SessionSandbox, type SandboxPrepared } from '../src/execution/session-sandbox'
import { sessionWorkspacePaths } from '../src/execution/session-workspace'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

// Execute the unmodified vendor in a fresh process. This checks its RPC-facing contract,
// not ActionDriver's runtime integration or the opaque Codex native helper.
function exerciseVendor(launch?: SandboxPrepared, cwd?: string) {
  const entry = pathToFileURL(join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/globals.js')).href
  const source = `
    const calls = [], writes = [], images = [];
    const methods = ['list_apps', 'get_app_state', 'click', 'set_value'];
    globalThis.nodeRepl = {
      env: Object.freeze({ CUA_REPL_ENABLED_SURFACES: 'computer' }),
      requestMeta: { call_id: 'test' },
      write: (text, tag) => writes.push({text, tag}),
      emitImage: image => images.push({bytes: [...image.bytes], mimeType: image.mimeType}),
      rpc: async (service, input) => {
        if (service !== 'sky') throw new Error('Unexpected service');
        calls.push(input);
        if (input.type === 'setup') return { target: 'mac', methods };
        if (input.method === 'get_app_state') return {
          app: '/System/Applications/Notes.app', text: '[42] AXButton',
          screenshot: { url: 'data:image/png;base64,AQID' }
        };
        return null;
      }
    };
    await import(${JSON.stringify(entry)});
    const initial = writes.length;
    const app = await cua.getApp('Notes');
    await app.click(42);
    await app.setValue(43, 'hello');
    const beforeQuiet = writes.length;
    const state = await app.getAXState({ emit: false, disableDiffing: true });
    const quiet = writes.length === beforeQuiet;
    const image = await app.getScreenshot();
    nodeRepl.requestMeta = {call_id:'next'};
    const beforeRewrite = writes.length;
    await cua.rewriteDocumentation();
    process.stdout.write(JSON.stringify({initial, calls, state, quiet, images,
      image:[...image], rewritten: writes.length > beforeRewrite,
      browserExposed: 'getBrowser' in cua}));
  `
  const executable = realpathSync(process.execPath)
  const args = ['--no-warnings', '--experimental-loader',
    join(process.cwd(), 'apps/agent-runtime/resources/js-repl/codex-module-loader.mjs'),
    '--input-type=module', '-e', source]
  const command = launch?.wrap(executable, args) ?? { executable, args }
  const result = spawnSync(command.executable, command.args, {
    encoding: 'utf8', timeout: 3000, cwd, env: {
      ...(launch?.environment ?? { PATH: process.env.PATH }),
      CUA_VENDOR_ROOT: join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua')
    }
  })
  if (result.status !== 0) throw new Error(result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}

describe('fixed Codex CUA contract', () => {
  it('emits initial docs without inventory and uses the trusted sky RPC interface', () => {
    const result = exerciseVendor()
    expect(result.initial).toBe(1)
    expect(result.calls[0]).toEqual({type: 'setup'})
    expect(result.calls[1]).toEqual({type: 'execute', method: 'get_app_state', args: [{app: 'Notes', disableDiff: true}]})
    expect(result.browserExposed).toBe(false)
  })
  it('preserves action parameters, quiet observation, image output and document rewriting', () => {
    const result = exerciseVendor()
    expect(result.calls).toContainEqual({type:'execute', method:'click', args:[{app:'/System/Applications/Notes.app',element_index:42}]})
    expect(result.calls).toContainEqual({type:'execute', method:'set_value', args:[{app:'/System/Applications/Notes.app',element_index:43,value:'hello'}]})
    expect(result.state).toBe('[42] AXButton')
    expect(result.quiet).toBe(true)
    expect(result.image).toEqual([1,2,3])
    expect(result.images).toEqual([{bytes:[1,2,3],mimeType:'image/png'}])
    expect(result.rewritten).toBe(true)
  })
})

 it.skipIf(process.platform !== 'darwin')('loads original vendor ESM inside the untrusted JS sandbox', async () => {
   const root = await mkdtemp(join(tmpdir(), 'actiondriver-vendor-sandbox-'))
   let launch: SandboxPrepared | undefined
   try {
     const executable = realpathSync(process.execPath)
     const workspace = sessionWorkspacePaths(root, 'session')
     launch = await new SessionSandbox({ runtimeRoots: [dirname(executable),
       join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua'),
       join(process.cwd(), 'apps/agent-runtime/resources/js-repl')] }).prepare({ workspace, jsExecutable: executable })
     const result = exerciseVendor(launch, workspace.root)
     expect(result.image).toEqual([1, 2, 3])
     expect(result.rewritten).toBe(true)
   } finally {
     await launch?.dispose()
     await rm(root, { recursive: true, force: true })
   }
 })
