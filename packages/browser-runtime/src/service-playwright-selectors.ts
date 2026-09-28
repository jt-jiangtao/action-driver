import { PlaywrightWorlds } from './service-playwright-worlds.js'
import type { PlaywrightCdp, SelectorExecutionTarget } from './service-playwright-worlds.js'
import type { CdpTarget } from './service-cdp-execution.js'
import type { CdpOptions } from './service-cdp-attachment.js'
import { selectorScopeFunctions } from './service-selector-scope.js'
import {
  assertSelectorDeadline,
  withSelectorDeadline,
  retrySelector,
  selectorTelemetry,
  selectorResult,
  isStrictSelectorError,
  selectorRetryDelay,
  selectorFrames,
  remainingSelector,
  isBlankSelectorFrame,
  selectorTargetKey
} from './service-selector-policy.js'
export interface FrameLink {
  frameId: string | null
  parentTarget: CdpTarget
  size: { width: number; height: number }
}
interface Route extends SelectorExecutionTarget {
  selector: string
  oopifFrameChain: FrameLink[]
}
interface NodeTarget {
  backendNodeId: number
  frameId?: string
  target: CdpTarget
  oopifFrameChain: FrameLink[]
}
interface Bound {
  executionContextId: number | undefined
  objectId: string
  selector: string
  target: CdpTarget
  oopifFrameChain: FrameLink[]
}
interface Options extends CdpOptions {
  isolatedWorld?: boolean | undefined
  retry?: boolean | undefined
  strict?: boolean | undefined
  arg?: unknown
  includeFrameIdentity?: boolean | undefined
  scrollFrameIntoView?: boolean | undefined
}
interface Span {
  currentPlaywrightOperation(fallback: string): string
}
interface Timing {
  startLocatorRetry(): { attemptFailed(): void; finish(outcome: 'success' | 'timeout'): void }
}
export interface SelectorCdp extends PlaywrightCdp {
  enableOopifAutoAttach?(id: number | string, options: CdpOptions): Promise<unknown>
  targetForFrame?(id: number | string, frameId: string): CdpTarget | null
  targetForFrameOrAttach?(
    id: number | string,
    frameId: string | null,
    options: CdpOptions,
    hints: { parentTarget?: CdpTarget; url?: string }
  ): Promise<CdpTarget | null>
}
const separator = ' >> internal:control=enter-frame >> ',
  frameUnavailable = 'Frame target is not available for this iframe selector path',
  timeout = (value: number | undefined) =>
    Math.min(Math.max(0, typeof value === 'number' ? value : 3000), 3000),
  serialized = (value: unknown) => JSON.stringify(value) ?? 'undefined'
function id(value: number | string) {
  const result = Number(value)
  if (!Number.isInteger(result) || result <= 0) throw Error('Expected a positive integer')
  return result
}
/** Concrete selector resolution, OOPIF routing and document-bound node handles. */
export class PlaywrightSelectors extends PlaywrightWorlds {
  declare cdp: SelectorCdp
  boundSelector: Bound | undefined
  constructor(
    cdp: SelectorCdp,
    public performanceSpan: Span,
    public commandTiming: Timing,
    public isIabBackend = false
  ) {
    super(cdp)
  }
  static selectorScopeFunctions = selectorScopeFunctions
  async frameIdForFrameMatch(
    target: CdpTarget,
    match: { frameUrl?: string; frameName?: string },
    options: CdpOptions = {}
  ) {
    if (match.frameUrl == null) return null
    const { frameTree } = await this.callCdpTarget(target, 'Page.getFrameTree', undefined, options)
    const frames = selectorFrames<{ id?: string; url?: string; name?: string }>(frameTree).filter(
      (frame) =>
        frame.url === match.frameUrl && (match.frameName == null || frame.name === match.frameName)
    )
    return frames.length !== 1 ? null : (frames[0]?.id ?? null)
  }
  async targetForFrame(
    tabId: number | string,
    frameId: string | null,
    hints: { parentTarget?: CdpTarget; url?: string },
    options: CdpOptions = {}
  ) {
    assertSelectorDeadline(options)
    return typeof this.cdp.targetForFrameOrAttach === 'function'
      ? await this.cdp.targetForFrameOrAttach(tabId, frameId, options, hints)
      : frameId == null
        ? null
        : (this.cdp.targetForFrame?.(tabId, frameId) ?? null)
  }
  async frameRouteForFirstOopif(
    input: SelectorExecutionTarget,
    selector: string,
    options: Options = {}
  ): Promise<Route | null> {
    if (
      !selector.includes(separator) ||
      typeof this.cdp.enableOopifAutoAttach !== 'function' ||
      typeof this.cdp.targetForFrame !== 'function'
    )
      return null
    assertSelectorDeadline(options)
    await this.cdp.enableOopifAutoAttach(input.target.tabId, options)
    assertSelectorDeadline(options)
    const result = await this.callRuntimeEvaluateWithPlaywrightInjectedInTarget(
      input.target,
      {
        expression: `(() => {const __name=(fn)=>fn;${selectorScopeFunctions()};const initialInjected=window.__codexPlaywrightInjected;const parsedSelector=initialInjected.parseSelector(${JSON.stringify(selector)});let currentRoot=document,currentInjected=initialInjected,partStart=0;while(true){const enterFrameIndex=parsedSelector.parts.findIndex((part,index)=>index>=partStart&&part.name==='internal:control'&&part.body==='enter-frame');if(enterFrameIndex===-1)return null;const element=querySelectorStrictWithVisibleFallback(currentInjected,sliceParsedSelector(parsedSelector,partStart,enterFrameIndex),currentRoot,${options.strict === true});if(!element)return null;const tag=String(element.localName||element.tagName||'').toLowerCase();if(tag!=='iframe'&&tag!=='frame')throw Error('internal:control=enter-frame must target a frame element');const state=currentInjected.elementState(element,'visible');if(state.received==='error:notconnected')throw Error('Frame is not connected');if(!state.matches)throw Error('Frame is not visible');if(${options.scrollFrameIntoView !== false})element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});let frameWindow,frameDocument;try{frameWindow=element.contentWindow;frameDocument=element.contentDocument||frameWindow?.document}catch{return element}if(!frameWindow||!frameDocument)return element;currentRoot=frameDocument;currentInjected=injectedForWindow(initialInjected,frameWindow);partStart=enterFrameIndex+1;}})()`,
        returnByValue: false
      },
      options,
      input.frameId
    )
    const object = result.result?.objectId,
      errorObject = result.exceptionDetails?.exception?.objectId
    let metaObject: string | undefined, metaError: string | undefined
    try {
      selectorResult(result)
      if (object == null) {
        assertSelectorDeadline(options)
        return null
      }
      assertSelectorDeadline(options)
      const [metadata, node] = await Promise.allSettled([
        this.callCdpTarget(
          input.target,
          'Runtime.callFunctionOn',
          {
            functionDeclaration: `function(){let ownerDocument=this.ownerDocument,enterFrameCount=1;while(ownerDocument!==document){const ownerFrame=ownerDocument?.defaultView?.frameElement;if(!ownerFrame)throw Error('Frame is not connected');ownerDocument=ownerFrame.ownerDocument;enterFrameCount++}const rect=this.getBoundingClientRect();if(!rect||rect.width<=0||rect.height<=0)throw Error('Frame does not have an actionable bounding box');let width=Number(this.clientWidth)||rect.width,height=Number(this.clientHeight)||rect.height;if(${this.isIabBackend}){const style=this.ownerDocument.defaultView.getComputedStyle(this);const size=(axis,current,a,b,c,d)=>{const computed=parseFloat(style[axis]),padding=parseFloat(style[a])+parseFloat(style[b]);if(!Number.isFinite(computed))return Math.round(current-padding);return Math.round(computed-(style.boxSizing==='border-box'?padding+parseFloat(style[c])+parseFloat(style[d]):0))};width=size('width',width,'paddingLeft','paddingRight','borderLeftWidth','borderRightWidth');height=size('height',height,'paddingTop','paddingBottom','borderTopWidth','borderBottomWidth')}if(width<=0||height<=0)throw Error('Frame does not have an actionable bounding box');return{enterFrameCount,frameName:this.name||undefined,frameUrl:this.src||undefined,size:{height,width}}}`,
            objectId: object,
            returnByValue: true
          },
          options
        ),
        this.callCdpTarget(input.target, 'DOM.describeNode', { objectId: object }, options)
      ])
      if (metadata.status === 'fulfilled') {
        metaObject = metadata.value.result?.objectId
        metaError = metadata.value.exceptionDetails?.exception?.objectId
      } else throw metadata.reason
      if (node.status === 'rejected') throw node.reason
      const match = selectorResult(metadata.value) as {
          enterFrameCount: number
          frameName?: string
          frameUrl?: string
          size: { width: number; height: number }
        },
        frameId =
          typeof node.value.node.frameId === 'string'
            ? node.value.node.frameId
            : await this.frameIdForFrameMatch(input.target, match, options)
      const target =
        isBlankSelectorFrame(match.frameUrl) ||
        (frameId != null &&
          this.playwrightFrameWorlds.has(selectorTargetKey(input.target, frameId)) &&
          this.cdp.targetForFrame(input.target.tabId, frameId) == null)
          ? null
          : await this.targetForFrame(
              input.target.tabId,
              frameId,
              {
                parentTarget: input.target,
                ...(match.frameUrl == null ? {} : { url: match.frameUrl })
              },
              options
            )
      assertSelectorDeadline(options)
      if ((target == null || options.isolatedWorld === true) && frameId == null)
        throw Error(frameUnavailable)
      const link: FrameLink = { frameId, parentTarget: input.target, size: match.size },
        chain = input.oopifFrameChain as FrameLink[],
        previous = chain.at(-1),
        links =
          previous != null &&
          selectorTargetKey(previous.parentTarget) === selectorTargetKey(link.parentTarget)
            ? [...chain.slice(0, -1), link]
            : [...chain, link]
      return {
        ...(frameId != null && (target == null || options.isolatedWorld === true)
          ? { frameId }
          : {}),
        oopifFrameChain: links,
        selector: remainingSelector(selector, match.enterFrameCount),
        target: target ?? input.target
      }
    } finally {
      await this.releaseRuntimeObjects(
        input.target,
        [object, errorObject, metaObject, metaError],
        options
      )
    }
  }
  async resolveSelectorTarget(
    input: SelectorExecutionTarget,
    selector: string,
    options: Options = {}
  ): Promise<Route> {
    let current = input,
      remaining = selector
    for (;;) {
      assertSelectorDeadline(options)
      const route = await this.frameRouteForFirstOopif(current, remaining, options)
      if (route == null)
        return {
          ...(current.frameId == null ? {} : { frameId: current.frameId }),
          oopifFrameChain: current.oopifFrameChain as FrameLink[],
          selector: remaining,
          target: current.target
        }
      current = route
      remaining = route.selector
    }
  }
  async frameIdForElementObject(target: CdpTarget, objectId: string, options: CdpOptions) {
    const result = await this.callCdpTarget(
        target,
        'Runtime.callFunctionOn',
        {
          functionDeclaration:
            'function(){try{return this.ownerDocument?.defaultView?.frameElement??null}catch{return null}}',
          objectId,
          returnByValue: false
        },
        options
      ),
      object = result.result?.objectId,
      error = result.exceptionDetails?.exception?.objectId
    try {
      selectorResult(result)
      if (object == null) return undefined
      return (await this.callCdpTarget(target, 'DOM.describeNode', { objectId: object }, options))
        .node.frameId as string | undefined
    } finally {
      await this.releaseRuntimeObjects(target, [object, error], options)
    }
  }
  async nodeForResolvedSelectorTarget(route: Route, options: Options) {
    const result = await this.callRuntimeEvaluateWithPlaywrightInjectedInTarget(
        route.target,
        {
          expression: `(()=>{const __name=(fn)=>fn;${selectorScopeFunctions()};const initialInjected=window.__codexPlaywrightInjected;const scope=selectorScopeFor(initialInjected,initialInjected.parseSelector(${JSON.stringify(route.selector)}));const element=scope?querySelectorStrictWithVisibleFallback(scope.injected,scope.parsed,scope.root):null;if(!element)throw Error('No element matched selector');return element;})()`,
          returnByValue: false
        },
        options,
        route.frameId
      ),
      object = result.result?.objectId,
      error = result.exceptionDetails?.exception?.objectId
    try {
      selectorResult(result)
      if (object == null) throw Error('Playwright selector did not resolve to a DOM node')
      const { node } = await this.callCdpTarget(
          route.target,
          'DOM.describeNode',
          { objectId: object },
          options
        ),
        frame = route.selector.includes(separator)
          ? await this.frameIdForElementObject(route.target, object, options)
          : route.frameId
      return {
        backendNodeId: node.backendNodeId as number,
        ...(frame == null ? {} : { frameId: frame })
      }
    } finally {
      await this.releaseRuntimeObjects(route.target, [object, error], options)
    }
  }
  async resolvePlaywrightSelectorNode(
    tabId: number,
    selector: string,
    options: Options = {}
  ): Promise<NodeTarget> {
    if (!Number.isFinite(tabId)) throw Error('resolvePlaywrightSelector requires numeric tab_id')
    const timeoutMs = timeout(options.timeoutMs),
      startedAt = Date.now(),
      budget = withSelectorDeadline(options, startedAt, timeoutMs)
    for (;;) {
      assertSelectorDeadline(budget)
      try {
        const callOptions = {
            deadlineMs: budget.deadlineMs,
            isolatedWorld: budget.isolatedWorld,
            timeoutMs,
            telemetryAttrs: selectorTelemetry({
              operation: this.performanceSpan.currentPlaywrightOperation('locator'),
              phase: 'selector_node'
            })
          },
          target: SelectorExecutionTarget = { target: { tabId: id(tabId) }, oopifFrameChain: [] }
        if (budget.isolatedWorld === true) {
          const { frameTree } = await this.callCdpTarget(
            target.target,
            'Page.getFrameTree',
            undefined,
            callOptions
          )
          if (!frameTree.frame.id) throw Error(frameUnavailable)
          target.frameId = frameTree.frame.id
        }
        const route = await this.resolveSelectorTarget(target, selector, callOptions)
        return {
          ...(await this.nodeForResolvedSelectorTarget(route, callOptions)),
          oopifFrameChain: route.oopifFrameChain,
          target: route.target
        }
      } catch (error) {
        if (isStrictSelectorError(error) || budget.retry === false) throw error
        if (Date.now() - startedAt >= timeoutMs)
          throw Error(
            `Timed out after ${timeoutMs}ms waiting for selector ${selector}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
          )
        assertSelectorDeadline(budget)
        await new Promise((resolve) => setTimeout(resolve, selectorRetryDelay(budget)))
      }
    }
  }
  async resolvePlaywrightSelector(tabId: number, selector: string) {
    return (await this.resolvePlaywrightSelectorNode(tabId, selector, { retry: false }))
      .backendNodeId
  }
  async withPlaywrightNode<T>(
    node: NodeTarget,
    run: (objectId: string, context: number | undefined) => Promise<T>,
    options: Options = {}
  ) {
    if (node.frameId != null)
      await this.ensurePlaywrightInjectedInTarget(node.target, options, node.frameId)
    const context =
        node.frameId == null
          ? undefined
          : (await this.playwrightFrameWorld(node.target, node.frameId, options))
              .executionContextId,
      { object } = await this.callCdpTarget(
        node.target,
        'DOM.resolveNode',
        {
          backendNodeId: node.backendNodeId,
          ...(context == null ? {} : { executionContextId: context })
        },
        options
      )
    if (object.objectId == null) throw Error('Playwright node has no document-bound handle')
    try {
      return await run(object.objectId, context)
    } finally {
      await this.releaseRuntimeObjects(node.target, [object.objectId], options)
    }
  }
  async withBoundPlaywrightSelector<T>(
    tabId: number,
    selector: string,
    allowed: () => Promise<boolean>,
    run: (bound: this) => Promise<T>,
    options: Options = {}
  ) {
    const node = await this.resolvePlaywrightSelectorNode(tabId, selector, {
      isolatedWorld: options.isolatedWorld,
      retry: false,
      timeoutMs: options.timeoutMs
    })
    return await this.withPlaywrightNode(
      node,
      async (objectId, executionContextId) => {
        const bound = {
          objectId,
          executionContextId,
          oopifFrameChain: node.oopifFrameChain,
          selector,
          target: node.target
        }
        if (!(await allowed())) return undefined
        return await run(Object.create(this, { boundSelector: { value: bound } }) as this)
      },
      options
    )
  }
  async evaluateOnPlaywrightSelectorWithTarget(
    tabId: number,
    selector: string,
    page: (...args: any[]) => unknown,
    options: Options = {}
  ) {
    const bound = this.boundSelector
    if (bound != null && bound.selector === selector && bound.target.tabId === Number(tabId)) {
      if (options.strict === true)
        throw Error('Strict evaluation cannot re-resolve a bound selector')
      if (options.isolatedWorld === true && bound.executionContextId == null)
        throw Error('Bound selector is not in an isolated world')
      const result = await this.callCdpTarget(
        bound.target,
        'Runtime.callFunctionOn',
        {
          arguments: options.arg == null ? [] : [{ value: options.arg }],
          awaitPromise: true,
          functionDeclaration: `async function(arg){const __name=(fn)=>fn;const injected=window.__codexPlaywrightInjected;if(!injected)throw Error('Browser Use Playwright injected helper is missing');if(!this.isConnected)throw Error('Element is not connected');${selectorScopeFunctions()};const frameChain=[];for(let frameWindow=this.ownerDocument?.defaultView;frameWindow?.frameElement;frameWindow=frameWindow.frameElement.ownerDocument?.defaultView){const element=frameWindow.frameElement;frameChain.unshift({element,injected:injectedForWindow(injected,element.ownerDocument?.defaultView)})}return await(${page.toString()})(this,injected,arg,{frameChain,prepareFrameChainForPointerAction:(point,alignment)=>prepareFrameChainForPointerAction(frameChain,point,alignment)});}`,
          objectId: bound.objectId,
          returnByValue: true
        },
        { timeoutMs: options.timeoutMs }
      )
      return {
        executionContextId: bound.executionContextId,
        result: selectorResult(result),
        oopifFrameChain: bound.oopifFrameChain,
        target: bound.target
      }
    }
    const timeoutMs = timeout(options.timeoutMs),
      startedAt = Date.now(),
      budget = withSelectorDeadline(options, startedAt, timeoutMs),
      target: SelectorExecutionTarget = { target: { tabId: id(tabId) }, oopifFrameChain: [] }
    if (options.isolatedWorld === true) {
      const { frameTree } = await this.callCdpTarget(
        target.target,
        'Page.getFrameTree',
        undefined,
        budget
      )
      if (!frameTree.frame.id) throw Error(frameUnavailable)
      target.frameId = frameTree.frame.id
    }
    return await retrySelector(
      selector,
      () =>
        this.evaluateSingleSelectorWithTarget(target, selector, page.toString(), budget.arg, {
          ...(budget.includeFrameIdentity == null
            ? {}
            : { includeFrameIdentity: budget.includeFrameIdentity }),
          ...(budget.isolatedWorld === true ? { isolatedWorld: true } : {}),
          ...(budget.strict === true ? { strict: true } : {}),
          scrollFrameIntoView: budget.scrollFrameIntoView,
          deadlineMs: budget.deadlineMs,
          timeoutMs,
          telemetryAttrs: selectorTelemetry({
            operation: this.performanceSpan.currentPlaywrightOperation('locator'),
            phase: 'selector_eval'
          })
        }),
      { deadlineMs: budget.deadlineMs, retry: budget.retry, startedAt, timeoutMs },
      this.commandTiming
    )
  }
  async evaluateOnPlaywrightSelector(
    tabId: number,
    selector: string,
    page: (...args: any[]) => unknown,
    options: Options = {}
  ) {
    return (await this.evaluateOnPlaywrightSelectorWithTarget(tabId, selector, page, options))
      .result
  }
  async evaluateSingleSelectorWithTarget(
    target: SelectorExecutionTarget,
    selector: string,
    page: string,
    arg: unknown,
    options: Options = {}
  ) {
    assertSelectorDeadline(options)
    const route = await this.resolveSelectorTarget(target, selector, options)
    assertSelectorDeadline(options)
    return {
      ...(options.includeFrameIdentity === true
        ? { frameIdentity: await this.frameIdentityForResolvedSelectorTarget(route, options) }
        : {}),
      ...(await this.evaluateSingleSelectorInResolvedTarget(route, page, arg, options)),
      oopifFrameChain: route.oopifFrameChain,
      target: route.target
    }
  }
  async frameIdentityForResolvedSelectorTarget(route: Route, options: Options = {}) {
    const { frameTree } = await this.callCdpTarget(
        route.target,
        'Page.getFrameTree',
        undefined,
        options
      ),
      frameId = route.selector.includes(separator)
        ? (await this.nodeForResolvedSelectorTarget(route, options)).frameId
        : (route.frameId ?? frameTree.frame.id),
      frame = selectorFrames<{
        id: string
        loaderId?: string
        url?: string
        domainAndRegistry?: string
      }>(frameTree).find((frame) => frame.id === frameId)
    if (frame?.id && frame.loaderId && frame.url)
      return {
        ...(frame.domainAndRegistry == null ? {} : { domainAndRegistry: frame.domainAndRegistry }),
        frameId: frame.id,
        loaderId: frame.loaderId,
        url: frame.url
      }
  }
  async evaluateSingleSelectorInResolvedTarget(
    route: Route,
    page: string,
    arg: unknown,
    options: Options = {}
  ) {
    const result = await this.callRuntimeEvaluateWithPlaywrightInjectedInTarget(
      route.target,
      {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async()=>{const __name=(fn)=>fn;${selectorScopeFunctions()};const initialInjected=window.__codexPlaywrightInjected;const scope=selectorScopeFor(initialInjected,initialInjected.parseSelector(${JSON.stringify(route.selector)}),${options.strict === true});const element=scope?querySelectorStrictWithVisibleFallback(scope.injected,scope.parsed,scope.root,${options.strict === true}):null;if(!element)throw Error('No element matched selector');return await(${page})(element,scope.injected,${serialized(arg)},scope);})()`
      },
      options,
      route.frameId
    )
    return { executionContextId: result.executionContextId, result: selectorResult(result) }
  }
  async evaluateOnPlaywrightNode(
    node: NodeTarget,
    page: (...args: any[]) => unknown,
    options: Options = {}
  ) {
    return await this.withPlaywrightNode(
      node,
      async (objectId, executionContextId) => {
        const result = await this.callCdpTarget(
          node.target,
          'Runtime.callFunctionOn',
          {
            arguments: options.arg == null ? [] : [{ value: options.arg }],
            awaitPromise: true,
            functionDeclaration: `function(arg){const __name=(fn)=>fn;const injected=window.__codexPlaywrightInjected;if(!this.isConnected)throw Error('Element is not connected');return (${page.toString()})(this,injected,arg);}`,
            objectId,
            returnByValue: true,
            userGesture: true
          },
          options
        )
        try {
          return { executionContextId, result: selectorResult(result), target: node.target }
        } finally {
          await this.releaseRuntimeObjects(
            node.target,
            [result.exceptionDetails?.exception?.objectId],
            options
          )
        }
      },
      options
    )
  }
  async prepareReadonlyLocatorAll(
    tabId: number,
    selector: string,
    expression: string,
    options: Options = {}
  ) {
    const route = await this.resolveSelectorTarget(
      { target: { tabId: id(tabId) }, oopifFrameChain: [] },
      selector,
      {
        deadlineMs: options.deadlineMs,
        timeoutMs: timeout(options.timeoutMs),
        telemetryAttrs: selectorTelemetry({
          operation: this.performanceSpan.currentPlaywrightOperation('locator'),
          phase: 'selector_scope'
        })
      }
    )
    return {
      expression: `(()=>{const __name=(fn)=>fn;${selectorScopeFunctions()};const injected=globalThis.__codexPlaywrightInjected;const parsed=injected.parseSelector(${JSON.stringify(route.selector)});const selectorScope=selectorScopeFor(injected,parsed);const elements=selectorScope?selectorScope.injected.querySelectorAll(selectorScope.parsed,selectorScope.root):[];return ${expression};})()`,
      frameId: route.frameId,
      target: route.target
    }
  }
  async evaluateSelectorAllInTarget(
    target: SelectorExecutionTarget,
    selector: string,
    page: string,
    arg: unknown,
    options: Options = {}
  ) {
    assertSelectorDeadline(options)
    const route = await this.resolveSelectorTarget(target, selector, options)
    assertSelectorDeadline(options)
    return await this.evaluateWithPlaywrightInjectedInTarget(
      route.target,
      `(async()=>{const __name=(fn)=>fn;${selectorScopeFunctions()};const initialInjected=window.__codexPlaywrightInjected;const scope=selectorScopeFor(initialInjected,initialInjected.parseSelector(${JSON.stringify(route.selector)}));const elements=scope?scope.injected.querySelectorAll(scope.parsed,scope.root):[];const scopedInjected=scope?scope.injected:initialInjected;return await(${page})(elements,scopedInjected,${serialized(arg)});})()`,
      options,
      route.frameId
    )
  }
  async evaluateOnPlaywrightSelectorAll(
    tabId: number,
    selector: string,
    page: (...args: any[]) => unknown,
    options: Options = {}
  ) {
    const timeoutMs = timeout(options.timeoutMs),
      startedAt = Date.now(),
      budget = withSelectorDeadline(options, startedAt, timeoutMs)
    return await retrySelector(
      selector,
      () =>
        this.evaluateSelectorAllInTarget(
          { target: { tabId: id(tabId) }, oopifFrameChain: [] },
          selector,
          page.toString(),
          budget.arg,
          {
            deadlineMs: budget.deadlineMs,
            timeoutMs,
            telemetryAttrs: selectorTelemetry({
              operation: this.performanceSpan.currentPlaywrightOperation('locator'),
              phase: 'selector_all_eval'
            })
          }
        ),
      { deadlineMs: budget.deadlineMs, retry: budget.retry, startedAt, timeoutMs },
      this.commandTiming
    )
  }
  async evaluateOnPlaywrightPage(
    tabId: number,
    page: (...args: any[]) => unknown,
    options: Options = {}
  ) {
    const target = { tabId: id(tabId) },
      callOptions = {
        telemetryAttrs: selectorTelemetry({
          operation: this.performanceSpan.currentPlaywrightOperation('page'),
          phase: 'page_eval'
        }),
        timeoutMs: options.timeoutMs
      }
    let frameId: string | undefined
    if (options.isolatedWorld === true) {
      const { frameTree } = await this.callCdpTarget(
        target,
        'Page.getFrameTree',
        undefined,
        callOptions
      )
      if (!frameTree.frame.id) throw Error(frameUnavailable)
      frameId = frameTree.frame.id
    }
    return await this.evaluateWithPlaywrightInjectedInTarget(
      target,
      `(async()=>{const __name=(fn)=>fn;const injected=window.__codexPlaywrightInjected;return await(${page.toString()})(injected,${serialized(options.arg)});})()`,
      callOptions,
      frameId
    )
  }
  async selectorsResolveToDistinctElements(
    tabId: number,
    selectors: string[],
    options: Options = {}
  ) {
    if (selectors.length < 2) return true
    return await this.evaluateWithPlaywrightInjected(
      tabId,
      `(()=>{const __name=(fn)=>fn;${selectorScopeFunctions()};const injected=window.__codexPlaywrightInjected;const elements=${JSON.stringify(selectors)}.map(selector=>querySelectorStrictWithVisibleFallback(injected,injected.parseSelector(selector),document));return elements.every((element,index)=>element!=null&&elements.indexOf(element)===index);})()`,
      {
        telemetryAttrs: selectorTelemetry({
          operation: this.performanceSpan.currentPlaywrightOperation('locator'),
          phase: 'selector_identity_eval'
        }),
        timeoutMs: options.timeoutMs
      }
    )
  }
}
