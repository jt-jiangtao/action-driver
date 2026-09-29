import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPUTER_USE_GUIDANCE_ERRORS } from '../../../src/tool-error-exposure'

// A fresh Node host is required for the original service's vm.SourceTextModule.
async function probe(source: string) {
  const directory = await mkdtemp(join(tmpdir(), 'actiondriver-cua-runtime-'))
  try {
    const bundle = join(directory, 'host.mjs')
    const compile = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import {build} from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'apps/agent-runtime/node_modules/esbuild/lib/main.js')).href)};
      await build({stdin:{contents:"export { createCuaRuntime } from './apps/agent-runtime/src/computer-use/cua-runtime'; export { AppApprovalBroker } from './apps/agent-runtime/src/computer-use/app-approval-broker'; export { createCuaEntryTools } from './apps/agent-runtime/src/computer-use/cua-tools';",
        resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:${JSON.stringify(bundle)}});
    `
      ],
      { encoding: 'utf8', timeout: 5000 }
    )
    if (compile.status !== 0) throw new Error(compile.stderr)
    const result = spawnSync(
      process.execPath,
      [
        '--no-warnings',
        '--experimental-vm-modules',
        '--input-type=module',
        '-e',
        `
      import {createCuaRuntime, AppApprovalBroker, createCuaEntryTools} from ${JSON.stringify(pathToFileURL(bundle).href)};
      import {mkdir,access,readdir} from 'node:fs/promises';
      import {join} from 'node:path';
      const root=${JSON.stringify(directory)};
      const workspace={root:join(root,'workspace'),input:join(root,'workspace/input'),output:join(root,'workspace/output')};
      await mkdir(workspace.input,{recursive:true}); await mkdir(workspace.output,{recursive:true});
      const events=[], requests=[],cleared=[],images=[],stopped=[];
      let runtime; let now=0;
      const policy={decision:'allowed',allowPersistentApproval:true,target:{bundleId:'com.apple.Notes',displayName:'Notes',appPath:'/System/Applications/Notes.app',risk:'low'}};
      const broker=new AppApprovalBroker({queryPolicy:async()=>policy,isAlwaysAllowed:async()=>false,
        persistAlwaysAllowed:async()=>{},emit:event=>events.push(event),withSuspendedTimeout:async(task,fn)=>runtime.withSuspendedTimeout(task,fn)});
      const runtimeOptions={
        runtimeDist:${JSON.stringify(join(process.cwd(), 'apps/agent-runtime/dist'))},
        entryPath:${JSON.stringify(join(process.cwd(), 'apps/agent-runtime/dist/js-repl/repl-server.mjs'))},
        broker,now:()=>now,clearSkill:session=>cleared.push(session),assertRunning:()=>{},
        stopTask:taskId=>stopped.push(taskId),
        invoke:async(input)=>{requests.push(input);if(input.operation==='app-policy')return input.app==='Terminal'?{...policy,decision:'forbidden',allowPersistentApproval:false,target:{...policy.target,bundleId:'com.apple.Terminal',displayName:'Terminal',appPath:'/System/Applications/Utilities/Terminal.app'}}:policy;
          if(input.operation==='app-state')return {app:'com.apple.Notes',text:'[42] AXButton',appSpecificInstructions:'fixture guidance',screenshot:{base64:'AQID',mimeType:'image/png'}};
          return {executed:true};}
      };runtime=createCuaRuntime(runtimeOptions);
      const texts=[]; const output={text:text=>texts.push(text),image:bytes=>images.push([...bytes])};
      const context=(taskId,sessionId='session')=>({taskId,sessionId,workspace});
      const wait=async(test)=>{for(let i=0;i<1000&&!test();i++)await new Promise(r=>setTimeout(r,2));if(!test())throw new Error('probe wait timed out')};
      try { ${source} } finally {await runtime.dispose()}
    `
      ],
      { encoding: 'utf8', timeout: 15_000, env: { PATH: process.env.PATH } }
    )
    if (result.status !== 0) throw new Error(result.stderr || String(result.error))
    return JSON.parse(result.stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('owned CUA runtime with sandboxed children', () => {
  it('allows browser-only cells while denying computer RPC in the same persistent JS session', async () => {
    const value = await probe(`
      await runtime.dispose();
      const browser=[];
      runtime=createCuaRuntime({...runtimeOptions,
        browserSkillLoaded:()=>true,computerSkillLoaded:()=>false,
        invokeBrowser:async(task,command)=>{browser.push({task,type:command.type});
          if(command.type==='list_browsers')return [{id:'iab',name:'ActionDriver',type:'iab'}];
          throw new Error('unexpected browser command')}
      });
      const cell=[];
      try {await runtime.run(context('browser-task'),
        'var seen=await cua.listBrowsers({emit:false});nodeRepl.write(seen[0].id);try{await cua.getApp("Notes")}catch(error){nodeRepl.write(error.message)}',
        {},{text:part=>cell.push(part),image:()=>{}})}
      catch(error){cell.push('FAILED:'+error.message)}
      process.stdout.write(JSON.stringify({cell,browser,computer:requests.filter(r=>r.operation==='app-state')}));
    `)
    expect(value.cell.join('')).toContain('iab')
    expect(value.cell.join('')).toContain(COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded)
    expect(value.browser).toContainEqual({ task: 'browser-task', type: 'list_browsers' })
    expect(value.computer).toEqual([])
  }, 20_000)

  it('uses the browser client to discover and observe a task-owned tab', async () => {
    const value = await probe(`
      await runtime.dispose();
      const browser=[];
      runtime=createCuaRuntime({...runtimeOptions,browserSkillLoaded:()=>true,
        invokeBrowser:async(_task,command)=>{browser.push(command.type);
          if(command.type==='get_browser')return {id:'iab',name:'ActionDriver',type:'iab',apiSupportOverrides:{'Tab.ax':true},capabilities:{browser:[],tab:[]}};
          if(command.type==='get_browser_documentation')return 'Browser documentation';
          if(command.type==='list_tabs')return {tabs:[{id:'tab-1',title:'Fixture',url:'https://example.org'}]};
          if(command.type==='get_tab')return {id:'tab-1',title:'Fixture',url:'https://example.org'};
          if(command.type==='tab_ax_get_state')return {state:'- document "Fixture"'};
          throw new Error('unexpected browser command:'+command.type)}
      });
      const cell=[];
      try {await runtime.run(context('task-a'),
        'const tab=await cua.getTab("tab-1",{browser:"iab"});nodeRepl.write(tab.id)',
        {},{text:part=>cell.push(part),image:()=>{}})}
      catch(error){cell.push('FAILED:'+error.message)}
      process.stdout.write(JSON.stringify({cell,browser}));
    `)
    expect(value.cell.join('')).toContain('tab-1')
    expect(value.cell.join('')).toContain('Fixture')
    expect(value.browser).toContain('tab_ax_get_state')
  }, 20_000)

  it('reads bundled browser documentation through the owned client', async () => {
    const value = await probe(`
      await runtime.dispose();
      const browser=[];
      runtime=createCuaRuntime({...runtimeOptions,browserSkillLoaded:()=>true,
        invokeBrowser:async(_task,command)=>{browser.push(command.type);
          if(command.type==='get_documentation')return {};
          throw new Error('unexpected host command:'+command.type)}
      });
      const cell=[];
      await runtime.run(context('task-a'),
        'nodeRepl.write((await agent.documentation.get("browser-troubleshooting")).length)',
        {},{text:part=>cell.push(part),image:()=>{}});
      process.stdout.write(JSON.stringify({cell,browser}));
    `)
    expect(Number(value.cell.at(-1))).toBeGreaterThan(100)
    expect(value.browser).toEqual(['get_documentation'])
  }, 20_000)

  it('releases only its owned browser sessions on reset', async () => {
    const value = await probe(`
      await runtime.dispose();
      const browser=[];
      runtime=createCuaRuntime({...runtimeOptions,browserSkillLoaded:()=>true,
        invokeBrowser:async(task,command)=>{browser.push({task,type:command.type});
          if(command.type==='list_browsers')return [{id:'iab',name:'ActionDriver',type:'iab'}];
          if(command.type==='close_task')return {closed:true};
          throw new Error('unexpected browser command')}
      });
      await runtime.run(context('task-a'),'await cua.listBrowsers({emit:false})',{},output);
      await runtime.reset('session');
      process.stdout.write(JSON.stringify({browser}));
    `)
    expect(value.browser).toEqual([
      { task: 'task-a', type: 'list_browsers' },
      { task: 'task-a', type: 'close_task' }
    ])
  }, 20_000)

  it('keeps computer authorization independent from browser authorization in one cell', async () => {
    const value = await probe(`
      await runtime.dispose();
      const browser=[];
      runtime=createCuaRuntime({...runtimeOptions,browserSkillLoaded:()=>false,
        computerSkillLoaded:()=>true,
        invoke:async(input)=>input.operation==='list-apps'?{apps:[]}:runtimeOptions.invoke(input),
        invokeBrowser:async(task,command)=>{browser.push({task,type:command.type});return []}
      });
      const cell=[];
      await runtime.run(context('task-a'),
        'try{await cua.listBrowsers({emit:false})}catch(error){nodeRepl.write(error.message)};try{await agent.documentation.get("browser-troubleshooting")}catch(error){nodeRepl.write(error.message)};const apps=await cua.listApps({emit:false});nodeRepl.write(apps.length)',
        {},{text:part=>cell.push(part),image:()=>{}});
      process.stdout.write(JSON.stringify({cell,browser}));
    `)
    expect(value.cell.join('')).toContain('BROWSER_SKILL_NOT_LOADED')
    expect(value.cell.join('').match(/BROWSER_SKILL_NOT_LOADED/gu)).toHaveLength(2)
    expect(value.cell.join('')).toContain('0')
    expect(value.browser).toEqual([])
  }, 20_000)

  it('keeps browser discovery usable when the computer helper fails', async () => {
    const value = await probe(`
      await runtime.dispose();
      runtime=createCuaRuntime({...runtimeOptions,browserSkillLoaded:()=>true,
        computerSkillLoaded:()=>true,
        invoke:async()=>{throw new Error('HELPER_UNAVAILABLE')},
        invokeBrowser:async(_task,command)=>command.type==='list_browsers'
          ? [{id:'iab',name:'ActionDriver',type:'iab'}]
          : (()=>{throw new Error('unexpected browser command')})()
      });
      const cell=[];
      await runtime.run(context('task-a'),
        'try{await cua.listApps({emit:false})}catch(error){nodeRepl.write(error.message)};nodeRepl.write((await cua.listBrowsers({emit:false}))[0].id)',
        {},{text:part=>cell.push(part),image:()=>{}});
      process.stdout.write(JSON.stringify({cell}));
    `)
    expect(value.cell.join('')).toContain('HELPER_UNAVAILABLE')
    expect(value.cell.join('')).toContain('iab')
  }, 20_000)

  it('emits browser screenshots as image assets without Base64 in text output', async () => {
    const value = await probe(`
      await runtime.dispose();
      runtime=createCuaRuntime({...runtimeOptions,browserSkillLoaded:()=>true,
        invokeBrowser:async(_task,command)=>{
          if(command.type==='get_browser')return {id:'iab',name:'ActionDriver',type:'iab',apiSupportOverrides:{'Tab.ax':true},capabilities:{browser:[],tab:[]}};
          if(command.type==='get_browser_documentation')return 'Browser documentation';
          if(command.type==='list_tabs')return {tabs:[{id:'tab-1',title:'Fixture',url:'https://example.org'}]};
          if(command.type==='get_tab')return {id:'tab-1',title:'Fixture',url:'https://example.org'};
          if(command.type==='tab_ax_get_state')return {state:'- document "Fixture"'};
          if(command.type==='tab_screenshot')return {data:'AQID'};
          throw new Error('unexpected browser command:'+command.type)}
      });
      const emitted=[];const cell=[];
      await runtime.run(context('task-a'),
        'const tab=await cua.getTab("tab-1",{browser:"iab"});nodeRepl.emitImage({bytes:await tab.screenshot(),mimeType:"image/png"})',
        {},{text:part=>cell.push(part),image:(bytes)=>emitted.push([...bytes])});
      process.stdout.write(JSON.stringify({cell,emitted}));
    `)
    expect(value.emitted).toEqual([[1, 2, 3]])
    expect(value.cell.join('')).not.toContain('AQID')
  }, 20_000)

  it('preserves bindings, approval and instructions across turns and clears all on reset', async () => {
    const value = await probe(`
      const first=runtime.run(context('one'),'var app = await cua.getApp("Notes"); var count = 41;',{},output);
      await wait(()=>events.length===1);
      const blocked=requests.filter(r=>!r.operation.startsWith('session-')).every(r=>r.operation==='app-policy');
      await broker.decide('one',events[0].request.requestId,'session');await first;
      const initial=texts.join('');
      await runtime.endTurn('one');texts.length=0;
      await runtime.run(context('two'),'nodeRepl.write(count+1); await app.getAXState();',{},output);
      const second=texts.join('');const requestedBeforeReset=events.filter(e=>e.type.endsWith('requested')).length;
      const pathTexts=[];
      await runtime.run(context('two'),'nodeRepl.write(nodeRepl.tmpDir)',{},{text:text=>pathTexts.push(text),image:()=>{}});
      const screenshotDirectory=pathTexts.at(-1);
      const screenshotFiles=await readdir(screenshotDirectory);
      await runtime.reset('session');texts.length=0;
      const deleted=await access(screenshotDirectory).then(()=>false,()=>true);
      const fresh=runtime.run(context('three'),'nodeRepl.write(typeof count); await cua.getApp("Notes");',{},output);
      await wait(()=>events.filter(e=>e.type.endsWith('requested')).length===2);
      const last=events.at(-1);await broker.decide('three',last.request.requestId,'session');await fresh;
      process.stdout.write(JSON.stringify({blocked,initial,second,requestedBeforeReset,fresh:texts.join(''),cleared,images,deleted,screenshotFiles}));
    `)
    expect(value.deleted).toBe(true)
    expect(value.screenshotFiles).toEqual([])
    expect(value.blocked).toBe(true)
    expect(value.initial).toContain('fixture guidance')
    expect(value.initial).toContain('cua.getApp')
    expect(value.second).toContain('42')
    expect(value.second).not.toContain('fixture guidance')
    expect(value.second).not.toContain('cua.getApp')
    expect(value.requestedBeforeReset).toBe(1)
    expect(value.fresh).toContain('undefined')
    expect(value.fresh).toContain('fixture guidance')
    expect(value.cleared).toContain('session')
  }, 20_000)

  it('cancels approval on turn end and recycles idle sessions and screenshots', async () => {
    const value = await probe(`
      const pending=runtime.run(context('one'),'await cua.getApp("Notes")',{},output).catch(e=>e.message);
      await wait(()=>events.length===1);await runtime.endTurn('one');const cancelled=await pending;
      const second=runtime.run(context('two'),'var kept=7; await cua.getApp("Notes")',{},output);
      await wait(()=>events.filter(e=>e.type.endsWith('requested')).length===2);
      await broker.decide('two',events.at(-1).request.requestId,'session');await second;
      const pngPath=requests.find(r=>r.operation==='app-state');
      await runtime.endTurn('two');now=30*60*1000+1;await runtime.sweep();texts.length=0;
      await runtime.run(context('three'),'nodeRepl.write(typeof kept)',{},output);
      process.stdout.write(JSON.stringify({cancelled,fresh:texts.join(''),cleared,pending:broker.getPending('one').length,hasState:!!pngPath}));
    `)
    expect(value.cancelled).toMatch(/CANCELLED|closed/)
    expect(value.pending).toBe(0)
    expect(value.hasState).toBe(true)
    expect(value.fresh).toContain('undefined')
    expect(value.fresh).toContain('cua.getApp')
    expect(value.cleared).toContain('session')
  }, 20_000)
  it('serializes tasks in one session without changing the active approval context', async () => {
    const value = await probe(`
      const first=runtime.run(context('one'),'var app=await cua.getApp("Notes")',{},output);
      await wait(()=>events.length===1);
      const second=runtime.run(context('two'),'await app.click(42)',{},output);
      await new Promise(r=>setTimeout(r,20));const blocked=requests.filter(r=>!r.operation.startsWith('session-')).every(r=>r.operation==='app-policy');
      await broker.decide('one',events[0].request.requestId,'session');await first;await second;
      const count=events.filter(e=>e.type.endsWith('requested')).length;
      await runtime.endTurn('one');await runtime.endTurn('two');
      process.stdout.write(JSON.stringify({blocked,count,task:events[0].request.taskId,actions:requests.filter(r=>r.operation==='act')}));
    `)
    expect(value.blocked).toBe(true)
    expect(value.task).toBe('one')
    expect(value.count).toBe(1)
    expect(value.actions).toHaveLength(1)
    expect(value.actions[0].sessionId).toBe('session')
  }, 20_000)

  it('supervises the overlay once per turn and hides it when the turn ends', async () => {
    const value = await probe(`
      await runtime.run(context('one'),'nodeRepl.write("first")',{},output);
      await runtime.run(context('one'),'nodeRepl.write("second")',{},output);
      await runtime.endTurn('one');
      const first=requests.filter(r=>r.operation.startsWith('session-')).map(r=>r.operation);
      requests.length=0;
      await runtime.run(context('two'),'nodeRepl.write("third")',{},output);
      await runtime.endTurn('two');
      const second=requests.filter(r=>r.operation.startsWith('session-'))
        .map(r=>[r.operation,r.sessionId]);
      process.stdout.write(JSON.stringify({first,second}));
    `)
    expect(value.first).toEqual(['session-start', 'session-end'])
    expect(value.second).toEqual([
      ['session-start', 'session'],
      ['session-end', 'session']
    ])
  }, 20_000)

  it('holds an application lease for the session and releases it when the turn ends', async () => {
    const value = await probe(`
      await runtime.dispose();
      const allowed=new AppApprovalBroker({queryPolicy:async()=>policy,isAlwaysAllowed:async()=>true,
        persistAlwaysAllowed:async()=>{},emit:event=>events.push(event),
        withSuspendedTimeout:async(task,fn)=>runtime.withSuspendedTimeout(task,fn)});
      runtime=createCuaRuntime({...runtimeOptions,broker:allowed});
      const run=(task,session,code)=>(async()=>{try{await runtime.run(context(task,session),code,{},output);return 'ok'}
        catch(e){return e.message}})();
      const first=await run('one','session-a','await cua.getApp("Notes")');
      const conflict=await run('two','session-b','await cua.getApp("Notes")');
      await runtime.endTurn('one');
      const released=await run('three','session-b','await cua.getApp("Notes")');
      process.stdout.write(JSON.stringify({first,conflict,released,texts}));
    `)
    expect(value.first).toBe('ok')
    expect(value.conflict).toContain('APP_BUSY')
    expect(value.released).toBe('ok')
  }, 20_000)

  it('ends the Computer Use session when the user stops it with Esc', async () => {
    const value = await probe(`
      await runtime.dispose();
      const invoke=runtimeOptions.invoke;
      runtime=createCuaRuntime({...runtimeOptions,invoke:async(input)=>{
        if(input.operation==='act')throw new Error('USER_STOPPED_SESSION: User stopped the Computer Use session');
        return invoke(input)}});
      const first=(async()=>{try{await runtime.run(context('one'),'var app=await cua.getApp("Notes"); await app.click(3);',{},output);return 'completed'}catch(e){return e.message}})();
      await wait(()=>events.length===1);await broker.decide('one',events[0].request.requestId,'session');
      const outcome=await first;
      const second=(async()=>{try{await runtime.run(context('two'),'nodeRepl.write(typeof app)',{},output);return 'completed'}catch(e){return e.message}})();
      process.stdout.write(JSON.stringify({outcome,fresh:await second,cleared,texts,stopTasks:stopped}));
    `)
    expect(value.outcome).toContain('USER_STOPPED_SESSION')
    expect(value.cleared).toContain('session')
    expect(value.fresh).toBe('completed')
    expect(value.texts.join('')).toContain('undefined')
    expect(value.stopTasks).toEqual(['one'])
  }, 20_000)

  it('evicts the least recently used session when a fifth session is opened', async () => {
    const value = await probe(`
      for(let i=0;i<4;i++){await runtime.run(context('task-'+i,'session-'+i),'var kept=1',{},output);await runtime.endTurn('task-'+i)}
      await runtime.run(context('touch','session-0'),'nodeRepl.write(kept)',{},output);await runtime.endTurn('touch');
      await runtime.run(context('fifth','session-4'),'var kept=2',{},output);await runtime.endTurn('fifth');
      const evicted=[...cleared];texts.length=0;
      await runtime.run(context('return','session-1'),'nodeRepl.write(typeof kept)',{},output);
      process.stdout.write(JSON.stringify({evicted,fresh:texts.join('')}));
    `)
    expect(value.evicted).toEqual(['session-1'])
    expect(value.fresh).toContain('undefined')
  }, 20_000)

  it('rejects a run reset before its asynchronous startup completes', async () => {
    const value = await probe(`
      const pending=runtime.run(context('one'),'var late=1',{},output).catch(e=>e.message);
      await runtime.reset('session');const result=await pending;
      await runtime.run(context('two'),'nodeRepl.write(typeof late)',{},output);
      process.stdout.write(JSON.stringify({result,fresh:texts.join('')}));
    `)
    expect(value.result).toContain('closed')
    expect(value.fresh).toContain('undefined')
  }, 20_000)

  it('fails a js call made before the Skill is read with the readable gate message', async () => {
    const value = await probe(`
      const tools=await createCuaEntryTools({...runtimeOptions,skillLoaded:()=>false,
        saveImage:async(session,bytes,mimeType)=>({assetId:'volatile-computer:test',sessionId:session,source:'upload',mimeType,width:1,height:1,byteLength:bytes.length})});
      const js=tools.tools.find(t=>t.definition.modelName==='tools_local_cua_js');const failures=[];
      const call={callId:'test',providerCallId:'test',modelName:'js',arguments:{code:'await cua.getState()'}};
      try{for await(const event of js.executor.execute(call,undefined,context('tool-task')))failures.push(event.kind)}
      catch(error){failures.push(error.message)}
      finally{await tools.dispose()}
      process.stdout.write(JSON.stringify({failures}));
    `)
    expect(value.failures).toEqual([COMPUTER_USE_GUIDANCE_ERRORS.skillNotLoaded])
    expect(JSON.stringify(value)).not.toContain('[redacted')
  }, 20_000)

  it('does not expose the original Sky package from the JS entry', async () => {
    const value = await probe(`
      let outcome='';
      try {await runtime.run(context('one'),
        'const mod = await import("@oai/sky"); throw new Error("keys:" + Object.keys(mod).length)',
        {},{text:()=>{},image:()=>{}})}
      catch (error) {outcome=error.message}
      process.stdout.write(JSON.stringify({outcome}));
    `)
    expect(value.outcome).not.toMatch(/keys:[1-9][0-9]*$/)
    expect(value.outcome).toMatch(/Cannot find package '@oai\/sky'|Cannot find module '@oai\/sky'/)
  }, 20_000)

  it('exposes only js and reset and awaits image delivery before the tool finishes', async () => {
    const value = await probe(`
      const saved=[];
      const tools=await createCuaEntryTools({...runtimeOptions,skillLoaded:session=>session==='session',
        saveImage:async(session,bytes,mimeType)=>{await new Promise(r=>setTimeout(r,10));saved.push({session,bytes:[...bytes],mimeType});return {assetId:'volatile-computer:test',sessionId:session,source:'upload',mimeType,width:1,height:1,byteLength:bytes.length}}});
      const js=tools.tools.find(t=>t.definition.modelName==='tools_local_cua_js');const output=[];
      const call={callId:'test',providerCallId:'test',modelName:'js',arguments:{code:'await nodeRepl.emitImage({bytes:new Uint8Array([1,2,3]),mimeType:"image/png"});nodeRepl.write("done")'}};
      try{for await(const event of js.executor.execute(call,undefined,context('tool-task')))output.push(event)}finally{await tools.dispose()}
      process.stdout.write(JSON.stringify({names:tools.tools.map(t=>t.definition.modelName),saved,assets:output.filter(e=>e.kind==='asset'),result:output.at(-1)}));
    `)
    expect(value.names).toEqual(['tools_local_cua_js', 'tools_local_cua_reset'])
    expect(value.saved).toEqual([{ session: 'session', bytes: [1, 2, 3], mimeType: 'image/png' }])
    expect(value.assets).toHaveLength(1)
    expect(value.result.kind).toBe('result')
    expect(value.result.output.output).toContain('done')
  }, 20_000)
  it('rejects raw RPC attempts to bypass application policy or forge host context', async () => {
    const value = await probe(`
      const code=\`const failures=[];
        for(const operation of [
          ()=>nodeRepl.rpc('sky',{type:'execute',method:'click',args:[{app:'Terminal',element_index:42}]}),
          ()=>nodeRepl.rpc('sky',{type:'execute',method:'click',args:[{app:'Notes',element_index:42}],taskId:'forged'}),
          ()=>nodeRepl.rpc('sky',{type:'execute',method:'createElicitation',args:[]}),
          ()=>nodeRepl.rpc('native',{operation:'act'}),
          ()=>import('node:child_process')
        ]) {try{await operation();failures.push('unexpected success')}catch(e){failures.push(e.message)}}
        nodeRepl.write(JSON.stringify(failures));\`;
      const text=[];await runtime.run(context('one'),code,{},{text:chunk=>text.push(chunk),image:()=>{}});
      process.stdout.write(JSON.stringify({failures:JSON.parse(text.at(-1)),events:events.length,actions:requests.filter(r=>r.operation==='act').length}));
    `)
    expect(value.failures).toHaveLength(5)
    expect(value.failures.slice(0, 4)).toEqual(Array(4).fill('nodeRepl.rpc is not a function'))
    expect(value.failures[4]).toMatch(/denied|not allowed|unavailable|blocked/i)
    expect(value.events).toBe(0)
    expect(value.actions).toBe(0)
  }, 20_000)
  it('does not count the real application approval wait against the cell budget', async () => {
    const value = await probe(`
      let settled=false;
      const pending=runtime.run(context('one'),'await cua.getApp("Notes")',{timeoutMs:200},output).finally(()=>settled=true);
      await wait(()=>events.length===1);await new Promise(r=>setTimeout(r,400));
      const stillWaiting=!settled;
      await broker.decide('one',events[0].request.requestId,'session');const result=await pending;
      process.stdout.write(JSON.stringify({stillWaiting,kind:result.kind,actions:requests.filter(r=>r.operation==='app-state').length}));
    `)
    expect(value.stillWaiting).toBe(true)
    expect(value.kind).toBe('completed')
    expect(value.actions).toBe(1)
  }, 20_000)

  it('cancels the real RPC approval on abort without native dispatch', async () => {
    const value = await probe(`
      const abort=new AbortController();
      const pending=runtime.run(context('one'),'await cua.getApp("Notes")',{signal:abort.signal},output).catch(e=>e.message);
      await wait(()=>events.length===1);abort.abort();const result=await pending;
      await runtime.sweep();
      process.stdout.write(JSON.stringify({result,pending:broker.getPending('one').length,actions:requests.filter(r=>r.operation!=='app-policy'&&!r.operation.startsWith('session-')).length,cleared}));
    `)
    expect(value.result).toContain('CANCELLED')
    expect(value.pending).toBe(0)
    expect(value.actions).toBe(0)
    expect(value.cleared).toContain('session')
  }, 20_000)
  it('tells the model to verify input that reached an app without confirmation', async () => {
    const value = await probe(`
      await runtime.dispose();
      const invoke=runtimeOptions.invoke;
      runtime=createCuaRuntime({...runtimeOptions,invoke:async(input)=>input.operation==='act'?{executed:false,delivered:true}:invoke(input)});
      const pending=runtime.run(context('one'),'const app=await cua.getApp("Notes"); await app.typeText("hi"); await app.paste("hi",{format:"text"});',{},output);
      await wait(()=>events.length===1);await broker.decide('one',events[0].request.requestId,'session');await pending;
      process.stdout.write(JSON.stringify({texts,notices:texts.join("").split("no confirmation").length-1}));
    `)
    expect(value.texts.join('')).toMatch(/reached the app, but the app gave no confirmation[\s\S]*getScreenshot\(\) or getAXState\(\)/)
    expect(value.notices).toBe(2)
  }, 20_000)
  it('persists the cell source and output so the call survives a reload', async () => {
    const value = await probe(`
      const tools=await createCuaEntryTools({...runtimeOptions,skillLoaded:()=>true,saveImage:async()=>{throw new Error('no images')}});
      await runtime.dispose();runtime=tools;
      const js=tools.tools[0];
      const call={callId:'persisted',providerCallId:'persisted',modelName:'js',arguments:{code:'nodeRepl.write("kept output")'}};
      const events=[];
      for await(const event of js.executor.execute(call,undefined,context('one')))events.push(event);
      await tools.dispose();
      process.stdout.write(JSON.stringify({redacts:typeof js.executor.redactForPersistence,events}));
    `)
    expect(value.redacts).toBe('undefined')
    expect(JSON.stringify(value.events)).toContain('nodeRepl.write')
    expect(JSON.stringify(value.events)).toContain('kept output')
  }, 20_000)
})
