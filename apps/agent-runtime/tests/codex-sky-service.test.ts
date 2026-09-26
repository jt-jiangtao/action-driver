import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

function run(source: string) {
  const host = pathToFileURL(
    join(process.cwd(), 'apps/agent-runtime/resources/js-repl/codex-service-host.mjs')
  ).href
  const vendor = join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua')
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-vm-modules',
      '--input-type=module',
      '-e',
      `
    import { createCodexSkyService } from ${JSON.stringify(host)};
    const vendorRoot = ${JSON.stringify(vendor)};
    ${source}
  `
    ],
    { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH } }
  )
  if (result.status !== 0) throw new Error(result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}

describe('trusted original Codex sky service', () => {
  it('binds concurrent approvals to trusted task contexts and cancels before native dispatch', () => {
    const result = run(`
      const asks = [], nativeCalls = [], policies = [];
      const waiting = new Map();
      const service = await createCodexSkyService({vendorRoot,
        nativeClient: {click:async input => nativeCalls.push(input)},
        approval: {
          queryPolicy:async (app, context) => {
            policies.push({app,taskId:context.taskId});
            return {decision:'allowed',allowPersistentApproval:true,
              target:{bundleId:app,displayName:app,appPath:'/Applications/'+app+'.app',risk:'low'}};
          },
          requestApproval:async (context, policy, signal) => {
            asks.push({taskId:context.taskId,sessionId:context.sessionId,app:policy.target.bundleId});
            await new Promise((resolve,reject) => {
              waiting.set(context.taskId,resolve);
              signal?.addEventListener('abort',()=>reject(new Error('CANCELLED')), {once:true});
            });
          }
        }, withSuspendedTimeout:async fn=>fn()
      });
      const abort = new AbortController();
      const a = service.handleRpc({type:'execute',method:'click',args:[{app:'A',element_index:1}]},
        {taskId:'one',sessionId:'session-one',signal:abort.signal}).catch(error=>error.message);
      const b = service.handleRpc({type:'execute',method:'click',args:[{app:'B',element_index:2}]},
        {taskId:'two',sessionId:'session-two'});
      while (asks.length < 2) await new Promise(resolve=>setTimeout(resolve,0));
      waiting.get('two')(); await b; abort.abort(); const cancelled = await a;
      let missingContext = false;
      try { await service.handleRpc({type:'execute',method:'click',args:[{app:'C',element_index:3}]}) }
      catch { missingContext = true }
      process.stdout.write(JSON.stringify({asks,policies,nativeCalls,cancelled,missingContext}));
    `)
    expect(result.asks).toEqual([
      { taskId: 'one', sessionId: 'session-one', app: 'A' },
      { taskId: 'two', sessionId: 'session-two', app: 'B' }
    ])
    expect(result.nativeCalls).toEqual([{ app: '/Applications/B.app', elementIndex: 2 }])
    expect(result.cancelled).toContain('CANCELLED')
    expect(result.missingContext).toBe(true)
    expect(result.policies).toHaveLength(2)
  })
  it('blocks the original policy wrapper and preserves its frozen application binding', () => {
    const result = run(`
      let release; let asks = 0; let suspends = 0;
      const approval = new Promise(resolve => { release = resolve });
      const nativeCalls = [];
      const service = await createCodexSkyService({vendorRoot,
        nativeClient: {
          getAppPolicy: async app => ({decision:'allowed',allowPersistentApproval:true,
            target:{bundleIdentifier:'com.apple.Notes',displayName:'Notes',appPath:'/System/Applications/Notes.app',risk:'low'}}),
          click: async input => nativeCalls.push(input)
        },
        createElicitation: async input => { asks++; await approval; return {action:'accept'} },
        withSuspendedTimeout: async operation => { suspends++; return await operation() }
      });
      const setup = await service.handleRpc({type:'setup'});
      const args = {app:'Notes',element_index:42};
      const pending = service.handleRpc({type:'execute',method:'click',args:[args]});
      await new Promise(resolve => setTimeout(resolve, 20));
      const blocked = asks === 1 && nativeCalls.length === 0;
      args.app = 'Terminal'; args.element_index = 99;
      release(); await pending;
      process.stdout.write(JSON.stringify({blocked,asks,suspends,setup,nativeCalls}));
    `)
    expect(result.blocked).toBe(true)
    expect(result.asks).toBe(1)
    expect(result.suspends).toBe(1)
    expect(result.setup.target).toBe('mac')
    expect(result.setup.methods).not.toContain('start_audio_recording')
    expect(result.nativeCalls).toEqual([
      { app: '/System/Applications/Notes.app', elementIndex: 42 }
    ])
  })

  it('reuses original state formatting and isolates instruction injection by session', () => {
    const result = run(`
      const options = {vendorRoot,
        nativeClient: {
          getAppPolicy: async () => ({decision:'allowed',allowPersistentApproval:true,
            target:{bundleIdentifier:'com.apple.Notes',displayName:'Notes',appPath:'/System/Applications/Notes.app',risk:'low'}}),
          getAppState: async () => ({app:{bundleIdentifier:'com.apple.Notes'},appSpecificInstructions:'fixture guidance',
            skyshot:{text:'[42] AXButton',screenshot:{url:'data:image/png;base64,AQID'}}})
        },createElicitation:async()=>({action:'accept'}),withSuspendedTimeout:async fn=>fn()
      };
      const first = await createCodexSkyService(options), second = await createCodexSkyService(options);
      const input = {type:'execute',method:'get_app_state',args:[{app:'Notes',disableDiff:true}]};
      const a = await first.handleRpc(input), b = await first.handleRpc(input), c = await second.handleRpc(input);
      let rejected = false, getters = 0;
      try { await first.handleRpc({type:'execute',method:'constructor',args:[]}) } catch { rejected = true }
      try { await first.handleRpc({type:'execute',method:'click',args:[Object.defineProperty({},'app',{get(){getters++;return 'Notes'}})]}) } catch {}
      process.stdout.write(JSON.stringify({a,b,c,rejected,getters}));
    `)
    expect(result.a).toEqual({
      app: '/System/Applications/Notes.app',
      screenshot: { url: 'data:image/png;base64,AQID' },
      text: '<app_specific_instructions>\nfixture guidance\n</app_specific_instructions>\n[42] AXButton'
    })
    expect(result.b.text).toBe('[42] AXButton')
    expect(result.c.text).toBe(result.a.text)
    expect(result.rejected).toBe(true)
    expect(result.getters).toBe(0)
  })
})
