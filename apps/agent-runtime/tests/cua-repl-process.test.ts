import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SessionSandbox, type SandboxPrepared } from '../src/execution/session-sandbox'
import { sessionWorkspacePaths } from '../src/execution/session-workspace'

function exerciseRepl(launch?: SandboxPrepared, cwd?: string) {
  const root = join(process.cwd(), 'apps/agent-runtime')
  const host = pathToFileURL(join(root, 'resources/js-repl/codex-service-host.mjs')).href
  const executable = realpathSync(process.execPath)
  const args = [
    '--no-warnings',
    '--experimental-vm-modules',
    '--experimental-loader',
    join(root, 'resources/js-repl/codex-module-loader.mjs'),
    join(root, 'resources/js-repl/repl-server.mjs')
  ]
  const command = launch?.wrap(executable, args) ?? { executable, args }
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-vm-modules',
      '--input-type=module',
      '-e',
      `
      import { spawn } from 'node:child_process';
      import { createInterface } from 'node:readline';
      import { createCodexSkyService } from ${JSON.stringify(host)};
      const texts = [], calls = [], actions = [], approvals = [];
      const vendorRoot = ${JSON.stringify(join(root, 'vendor/codex-cua'))};
      const service = await createCodexSkyService({vendorRoot,
        nativeClient: {
          getAppState:async()=>({app:{bundleIdentifier:'com.apple.Notes'},skyshot:{text:'[42] AXButton'}}),
          click:async input=>actions.push(input)
        },approval:{
          queryPolicy:async()=>({decision:'allowed',allowPersistentApproval:true,
            target:{bundleId:'com.apple.Notes',displayName:'Notes',appPath:'/System/Applications/Notes.app',risk:'low'}}),
          requestApproval:async(context,policy)=>approvals.push({taskId:context.taskId,app:policy.target.bundleId})
        },withSuspendedTimeout:async fn=>fn()
      });
      const child = spawn(${JSON.stringify(command.executable)}, ${JSON.stringify(command.args)},
        {cwd:${JSON.stringify(cwd)},env:{...${JSON.stringify(launch?.environment ?? { PATH: process.env.PATH })},CUA_VENDOR_ROOT:vendorRoot},stdio:['pipe','pipe','pipe']});
      let stderr = ''; child.stderr.on('data',chunk=>stderr+=chunk);
      const cells = new Map();
      createInterface({input:child.stdout}).on('line', async line=>{
        const message=JSON.parse(line);
        if(message.type==='text') texts.push(message.text);
        else if(message.type==='call') {
          calls.push(message.method);
          try {
            if(message.method!=='sky_rpc') throw new Error('Unexpected capability channel');
            const value=await service.handleRpc(message.args,{taskId:'task',sessionId:'session'});
            child.stdin.write(JSON.stringify({type:'callResult',id:message.id,ok:true,value})+'\\n');
          } catch(error) {child.stdin.write(JSON.stringify({type:'callResult',id:message.id,ok:false,error:error.message})+'\\n')}
        } else cells.get(message.id)?.(message);
      });
      let id=0;
      const run=input=>new Promise(resolve=>{cells.set(++id,resolve);child.stdin.write(JSON.stringify({id,...input})+'\\n')});
      const first=await run({code:"var marker = 7; var app = await cua.getApp('Notes'); await app.click(42); nodeRepl.write({unsafe:typeof nodeRepl.createElicitation, timer:typeof nodeRepl.withSuspendedTimeout});"});
      const second=await run({code:"nodeRepl.write(marker);"});
      const reset=await run({reset:true});
      const third=await run({code:"nodeRepl.write(typeof marker);"});
      child.kill();
      process.stdout.write(JSON.stringify({first,second,reset,third,texts,calls,actions,approvals,stderr}));
    `
    ],
    { encoding: 'utf8', timeout: 6000, env: { PATH: process.env.PATH } }
  )
  if (result.status !== 0) throw new Error(result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}

describe('original CUA through the real REPL process', () => {
  it('routes model actions through original trusted policy and resets bindings and documentation', () => {
    const value = exerciseRepl()
    expect(value.first.ok).toBe(true)
    expect(value.second.ok).toBe(true)
    expect(value.third.ok).toBe(true)
    expect(value.texts).toContain('7')
    expect(value.texts).toContain('undefined')
    expect(value.texts).toContain(JSON.stringify({ unsafe: 'undefined', timer: 'undefined' }))
    expect(value.texts.filter((text: string) => text.includes('cua.getApp'))).toHaveLength(2)
    expect(value.calls.every((method: string) => method === 'sky_rpc')).toBe(true)
    expect(value.actions).toEqual([{ app: '/System/Applications/Notes.app', elementIndex: 42 }])
    expect(value.approvals).toEqual([
      { taskId: 'task', app: 'com.apple.Notes' },
      { taskId: 'task', app: 'com.apple.Notes' }
    ])
  })
  it.skipIf(process.platform !== 'darwin')(
    'runs the same trusted RPC chain with the model inside the macOS sandbox',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'actiondriver-cua-repl-'))
      let launch: SandboxPrepared | undefined
      try {
        const workspace = sessionWorkspacePaths(root, 'session')
        launch = await new SessionSandbox({
          runtimeRoots: [
            dirname(realpathSync(process.execPath)),
            join(process.cwd(), 'apps/agent-runtime/resources/js-repl'),
            join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua')
          ]
        }).prepare({
          workspace,
          jsExecutable: realpathSync(process.execPath)
        })
        const value = exerciseRepl(launch, workspace.root)
        expect(value.first.ok).toBe(true)
        expect(value.third.ok).toBe(true)
        expect(value.actions).toEqual([{ app: '/System/Applications/Notes.app', elementIndex: 42 }])
        expect(value.texts).toContain(JSON.stringify({ unsafe: 'undefined', timer: 'undefined' }))
      } finally {
        await launch?.dispose()
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
