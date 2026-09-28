// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { originalDocumentation } from './original-service'
const own = async () =>
  ((await import('../src/service-readonly-evaluate').catch(() => ({}))) as any).evaluateReadonly
test('isolated read-only page evaluation decodes results, blocks mutation and releases returned handles like original', async () => {
  const candidate = await own()
  expect(typeof candidate).toBe('function')
  const base = await originalDocumentation()
  async function exercise(run: any, script: string) {
    const dom = new JSDOM('<body><h1>Title</h1></body>', {
        runScripts: 'outside-only',
        url: 'https://example.test/'
      }),
      w = dom.window,
      calls: any[] = []
    const cdp = {
      call: async (_id: number, method: string, params: any, _options: any) => {
        calls.push([
          method,
          method === 'Runtime.evaluate'
            ? params?.expression?.startsWith('delete globalThis')
              ? 'delete'
              : 'evaluate'
            : (params?.frameId ?? null)
        ])
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 }
        if (method === 'Runtime.evaluate')
          try {
            return { result: { value: await w.eval(params.expression) } }
          } catch (e: any) {
            return { exceptionDetails: { text: e.message } }
          }
        return {}
      },
      callTarget: async () => {
        throw Error('unexpected target call')
      }
    }
    const ctx = {
      cdp,
      playwright: {},
      commandTiming: { startLocatorRetry: () => ({ attemptFailed: () => {}, finish: () => {} }) }
    }
    let result, error
    try {
      result = await run({ tab_id: 3, script, timeout_ms: 100 }, ctx)
    } catch (e: any) {
      error = e.message
    }
    const state = { result, error, calls, html: w.document.body.innerHTML }
    w.close()
    return state
  }
  for (const script of [
    'return document.querySelector("h1").textContent',
    'document.body.textContent="changed";return 1',
    'return import("other")',
    'return {array:[1,2],missing:undefined}'
  ])
    expect(await exercise(candidate, script)).toEqual(
      await exercise(base.baselineReadonlyEvaluate, script)
    )
})
test('read-only selector modes bind node handles, route all-selector expressions and validate missing selectors', async () => {
  const candidate = await own(),
    base = await originalDocumentation()
  async function exercise(run: any, mode: string) {
    const dom = new JSDOM('<body><h1 id="first">One</h1><h1>Two</h1></body>', {
        runScripts: 'outside-only',
        url: 'https://example.test/'
      }),
      w = dom.window,
      calls: string[] = []
    const cdp = {
        call: async (_id: number, method: string, params: any) => {
          calls.push(method)
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
          if (method === 'Page.createIsolatedWorld') return { executionContextId: 9 }
          if (method === 'DOM.resolveNode') return { object: { objectId: 'node' } }
          if (method === 'Runtime.callFunctionOn') {
            w.__browserUseReadonlyElement0 = w.document.querySelector('#first')
            return { result: { value: undefined } }
          }
          if (method === 'Runtime.evaluate') {
            if (params.expression?.includes('var PlaywrightInjected'))
              return { result: { value: undefined } }
            try {
              return { result: { value: await w.eval(params.expression) } }
            } catch (e: any) {
              return { exceptionDetails: { text: e.message } }
            }
          }
          return {}
        },
        callTarget: async () => {
          throw Error('unexpected target call')
        }
      },
      playwright = {
        resolvePlaywrightSelectorNode: async () => ({
          backendNodeId: 7,
          target: { tabId: 3 },
          frameId: 'main'
        }),
        prepareReadonlyLocatorAll: async () => ({
          target: { tabId: 3 },
          frameId: 'main',
          expression: 'Promise.resolve(["One","Two"])'
        })
      },
      commandTiming = { startLocatorRetry: () => ({ attemptFailed: () => {}, finish: () => {} }) }
    const params: any = {
      tab_id: 3,
      script: mode === 'node' ? 'return element.textContent' : 'return 1',
      timeout_ms: 100
    }
    if (mode === 'node') params.selector = '#first'
    if (mode === 'all' || mode === 'missing') {
      params.selector_mode = 'all'
      if (mode === 'all') params.selector = 'h1'
    }
    let result, error
    try {
      result = await run(params, { cdp, playwright, commandTiming })
    } catch (e: any) {
      error = e.message
    }
    w.close()
    return { result, error, calls }
  }
  for (const mode of ['node', 'all', 'missing'])
    expect(await exercise(candidate, mode)).toEqual(
      await exercise(base.baselineReadonlyEvaluate, mode)
    )
})
test('all-selector readonly evaluation installs actual Playwright helper and serializes live DOM values',async()=>{
 const candidate=await own(),base=await originalDocumentation();const {PlaywrightInput}=await import('../src/service-playwright-input'),{CommandTiming}=await import('../src/service-command-timing'),{EventEmitter}=await import('node:events')
 async function exercise(run:any){const dom=new JSDOM('<body><h1>One</h1><h1>Two</h1></body>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.test/'}),w=dom.window,calls:string[]=[];const style=w.getComputedStyle.bind(w);w.getComputedStyle=el=>style(el);w.Element.prototype.getClientRects=()=>[{left:0,right:100,top:0,bottom:30,width:100,height:30}] as any
  const cdp=Object.assign(new EventEmitter(),{platform:'darwin',call:async(_id:number,method:string,params:any)=>{calls.push(method);if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main',url:'https://example.test/'}}};if(method==='Page.createIsolatedWorld')return {executionContextId:7};if(method==='Runtime.evaluate')try{return {result:{value:await w.eval(params.expression)}}}catch(e:any){return {exceptionDetails:{text:e.message}}};return {}},callTarget:async(target:any,method:string,params:any)=>await cdp.call(target.tabId,method,params)})
  const timing=new CommandTiming(),playwright=new PlaywrightInput(cdp as any,{} as any,{currentPlaywrightOperation:(name:string)=>name},timing);let result,error
  try{result=await run({tab_id:3,selector:'h1',selector_mode:'all',script:'return elements.map(element=>element.textContent)',timeout_ms:1000},{cdp,playwright,commandTiming:timing})}catch(e:any){error=e.message}
  w.close();return {result,error,calls}
 }
 const result=await exercise(candidate);expect(result).toEqual(await exercise(base.baselineReadonlyEvaluate));expect(result.error).toBeUndefined();expect(result.result?.value).toEqual(['One','Two'])
})
test('destroyed isolated world is rebuilt once and exception handles are always released',async()=>{
 const candidate=await own(),base=await originalDocumentation()
 async function exercise(run:any,mode:string,id:number){const dom=new JSDOM('<body><p>live</p></body>',{runScripts:'outside-only',url:'https://example.test/'}),w=dom.window,calls:string[]=[];let attempts=0,worlds=0
  const cdp={call:async(_id:number,method:string,params:any)=>{calls.push(method);if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};if(method==='Page.createIsolatedWorld')return {executionContextId:++worlds};if(method==='Runtime.evaluate'){
    if(mode==='destroyed'&&++attempts===1)throw Error('Execution context was destroyed');
    if(mode==='exception')return {result:{objectId:'result-handle'},exceptionDetails:{exception:{description:'page exception',objectId:'error-handle'}}};
    return {result:{value:await w.eval(params.expression)}}
  }return {}},callTarget:async()=>{throw Error('unexpected target')}}
  let result,error;try{result=await run({tab_id:id,script:'return document.querySelector("p").textContent',timeout_ms:200},{cdp})}catch(e:any){error=e.message}w.close();return {result,error,calls,worlds}
 }
 for(const [index,mode] of ['destroyed','exception'].entries()){const result=await exercise(candidate,mode,810+index);expect(result).toEqual(await exercise(base.baselineReadonlyEvaluate,mode,810+index));if(mode==='destroyed')expect(result.worlds).toBe(2);else expect(result.calls.filter(method=>method==='Runtime.releaseObject')).toHaveLength(2)}
})

test('failed locator binding removes temporary page global and releases the node handle', async () => {
  const candidate = await own(), base = await originalDocumentation()
  async function exercise(run: any, id: number) {
    const dom = new JSDOM('<body><button>Target</button></body>', {
      runScripts: 'outside-only', url: 'https://example.test/'
    }), w = dom.window, released: string[] = []
    const cdp = {
      call: async (_tab: number, method: string, params: any) => {
        if (method === 'DOM.resolveNode') return { object: { objectId: 'node-handle' } }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 }
        if (method === 'Runtime.callFunctionOn') {
          ;(w as any)[params.arguments[0].value] = w.document.querySelector('button')
          return { exceptionDetails: { text: 'binding failed', exception: { objectId: 'error-handle' } } }
        }
        if (method === 'Runtime.evaluate') {
          if (params.expression.startsWith('delete globalThis')) {
            await w.eval(params.expression)
            return { result: { value: undefined } }
          }
          throw Error('should not evaluate user code')
        }
        if (method === 'Runtime.releaseObject') released.push(params.objectId)
        return {}
      },
      callTarget: async () => { throw Error('unexpected target') }
    }
    const playwright = { resolvePlaywrightSelectorNode: async () => ({
      backendNodeId: 1, frameId: 'main', target: { tabId: id }
    }) }
    const timing = { startLocatorRetry: () => ({ attemptFailed() {}, finish() {} }) }
    let error: string | undefined
    try {
      await run({ tab_id: id, selector: 'button', script: 'return element.textContent', timeout_ms: 0 },
        { cdp, playwright, commandTiming: timing })
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    const globals = Object.getOwnPropertyNames(w).filter(name => name.startsWith('__browserUseReadonlyElement'))
    w.close()
    return { error, globals, released }
  }
  expect(await exercise(candidate, 9001)).toEqual(await exercise(base.baselineReadonlyEvaluate, 9001))
})

test('read-only locator treats strict matches as terminal and recovers a destroyed world without leaking handles', async () => {
  const candidate = await own(), base = await originalDocumentation()
  async function exercise(run: any, mode: 'strict' | 'destroyed', tabId: number) {
    const calls: Array<[string, string?]> = []
    let worlds = 0, evaluations = 0, failures = 0
    const cdp = {
      call: async (_id: number, method: string, params: any) => {
        calls.push([method, params?.objectId])
        if (method === 'Page.createIsolatedWorld') return { executionContextId: ++worlds }
        if (method === 'DOM.resolveNode') return { object: { objectId: `node-${worlds}` } }
        if (method === 'Runtime.callFunctionOn') return { result: { value: undefined } }
        if (method === 'Runtime.evaluate') {
          if (params.expression.startsWith('delete globalThis')) return { result: { value: undefined } }
          if (mode === 'destroyed' && ++evaluations === 1) throw Error('Execution context was destroyed')
          return { result: { value: 'live', objectId: `result-${worlds}` } }
        }
        return {}
      },
      callTarget: async () => { throw Error('unexpected target') }
    }
    const playwright = {
      resolvePlaywrightSelectorNode: async () => {
        if (mode === 'strict') throw Error('strict mode violation: two matching nodes')
        return { backendNodeId: 42, target: { tabId }, frameId: 'main' }
      }
    }
    const commandTiming = {
      startLocatorRetry: () => ({ attemptFailed: () => { failures++ }, finish: () => {} })
    }
    let result: unknown, error: string | undefined
    try {
      result = await run({ tab_id: tabId, selector: 'button', script: 'return element.textContent', timeout_ms: 300 },
        { cdp, playwright, commandTiming })
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    return { result, error, calls, worlds, failures }
  }
  for (const [index, mode] of (['strict', 'destroyed'] as const).entries()) {
    const tabId = 9200 + index
    const result = await exercise(candidate, mode, tabId)
    expect(result).toEqual(await exercise(base.baselineReadonlyEvaluate, mode, tabId))
    if (mode === 'strict') expect(result.failures).toBe(0)
    else {
      expect(result.error).toBeUndefined()
      expect(result.worlds).toBe(2)
      expect(result.calls.filter(([method]) => method === 'Runtime.releaseObject')).toHaveLength(3)
    }
  }
})
