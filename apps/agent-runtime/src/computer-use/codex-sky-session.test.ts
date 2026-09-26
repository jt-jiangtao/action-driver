import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('original sky service and helper adapter integration', () => {
  it('uses real broker decisions and native protocol across consecutive actions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'actiondriver-sky-host-'))
    try {
      const bundle = join(directory, 'host.mjs')
      const compiled = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import {build} from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'apps/agent-runtime/node_modules/esbuild/lib/main.js')).href)};
        await build({stdin:{contents:"export { createCodexSkySession } from './apps/agent-runtime/src/computer-use/codex-sky-session'; export { AppApprovalBroker } from './apps/agent-runtime/src/computer-use/app-approval-broker'; export { ApplicationLeases } from './apps/agent-runtime/src/computer-use/application-leases';",
          resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:${JSON.stringify(bundle)}});
      `
        ],
        { encoding: 'utf8', timeout: 5000 }
      )
      if (compiled.status !== 0) throw new Error(compiled.stderr)
      const result = spawnSync(
        process.execPath,
        [
          '--no-warnings',
          '--experimental-vm-modules',
          '--input-type=module',
          '-e',
          `
        import { createCodexSkySession, AppApprovalBroker, ApplicationLeases } from ${JSON.stringify(pathToFileURL(bundle).href)};
        const requests=[],events=[]; let gateChecks=0;
        const policy={decision:'allowed',allowPersistentApproval:true,
          target:{bundleId:'com.apple.Notes',displayName:'Notes',appPath:'/System/Applications/Notes.app',risk:'low'}};
        const broker=new AppApprovalBroker({queryPolicy:async()=>policy,isAlwaysAllowed:async()=>false,
          persistAlwaysAllowed:async()=>{},withSuspendedTimeout:async(_,fn)=>fn(),emit:event=>events.push(event)});
        const options={leases:new ApplicationLeases(),
          vendorRoot:${JSON.stringify(join(process.cwd(), 'apps/agent-runtime/vendor/codex-cua'))},
          serviceModule:${JSON.stringify(pathToFileURL(join(process.cwd(), 'apps/agent-runtime/resources/js-repl/codex-service-host.mjs')).href)},
          broker,assertRunning:()=>{gateChecks++},withSuspendedTimeout:async(_,fn)=>fn(),
          invoke:async(input)=>{requests.push(input);
            if(input.operation==='app-policy') return policy;
            if(input.operation==='app-state')return {app:'com.apple.Notes',text:'[42] AXButton'};
            return {executed:true};},
          writeScreenshot:async()=> 'file:///unused.png'
        };
        const session=await createCodexSkySession(options);
        const other=await createCodexSkySession(options);
        const context={taskId:'task',sessionId:'session'};
        const state=session.invoke({type:'execute',method:'get_app_state',args:[{app:'Notes'}]},context);
        while(!events.length) await new Promise(resolve=>setTimeout(resolve,0));
        const beforeApproval=requests.map(r=>r.operation);
        await broker.decide('task',events[0].request.requestId,'session');
        const output=await state;
        await session.invoke({type:'execute',method:'click',args:[{app:'Notes',element_index:42}]},context);
        await session.invoke({type:'execute',method:'type_text',args:[{app:'Notes',text:'hello'}]},context);
        const firstRequests=[...requests],firstEvents=events.map(e=>e.type);
        const otherContext={taskId:'other-task',sessionId:'other-session'};
        const second=other.invoke({type:'execute',method:'get_app_state',args:[{app:'com.apple.Notes'}]},otherContext).catch(error=>error.message);
        while(events.length<3) await new Promise(resolve=>setTimeout(resolve,0));
        await broker.decide('other-task',events[2].request.requestId,'session');
        const blocked=await second;
        const nativeCountBeforeRelease=requests.filter(r=>r.operation!=='app-policy').length;
        session.releaseTurn('task');
        await other.invoke({type:'execute',method:'get_app_state',args:[{app:'Notes'}]},otherContext);
        other.releaseSession('other-session');
        await session.invoke({type:'execute',method:'get_app_state',args:[{app:'Notes'}]},context);
        process.stdout.write(JSON.stringify({requests:firstRequests,events:firstEvents,beforeApproval,output,gateChecks,blocked,nativeCountBeforeRelease}));
      `
        ],
        { encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH } }
      )
      if (result.status !== 0) throw new Error(result.stderr || String(result.error))
      const value = JSON.parse(result.stdout)
      expect(value.blocked).toContain('APP_BUSY')
      expect(value.nativeCountBeforeRelease).toBe(3)
      expect(value.beforeApproval).toEqual(['app-policy'])
      expect(value.output).toEqual({
        app: '/System/Applications/Notes.app',
        text: '[42] AXButton',
        screenshot: null
      })
      expect(value.events).toEqual([
        'computer.app-approval.requested',
        'computer.app-approval.resolved'
      ])
      expect(value.requests.filter((r: Record<string, unknown>) => r.operation === 'act')).toEqual([
        {
          operation: 'act',
          app: '/System/Applications/Notes.app',
          sessionId: 'session',
          action: { type: 'click-element', elementIndex: 42 }
        },
        {
          operation: 'act',
          app: '/System/Applications/Notes.app',
          sessionId: 'session',
          action: { type: 'type', text: 'hello' }
        }
      ])
      expect(
        value.requests.filter((r: Record<string, unknown>) => r.operation === 'app-policy')
      ).toHaveLength(3)
      expect(value.gateChecks).toBeGreaterThanOrEqual(3)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
