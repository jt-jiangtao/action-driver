import { axIdentity, axSnapshotMetadata, mergeAxDocuments } from './service-ax-snapshot.js'
/** A capture may only be consumed in its originating session and document. */
export class StaleAxCaptureError extends Error {
  constructor() { super('Accessibility capture belongs to a previous page') }
}
const documentKey = (frame?: string, loader?: string) => `${frame ?? ''}:${loader ?? ''}`
const targetKey = (target: any) => `${target.tabId}:${target.sessionId ?? target.targetId ?? 'root'}`

export class AxState {
  sessions = new Map<unknown, Map<number, any>>()
  captureProvenance = new WeakMap<object, any>()
  private removeTabCleanupHandler?: () => void
  constructor(
    private readonly cdp: any,
    private readonly getSessionId: () => unknown,
    private readonly actions: { perform(tabId: number, action: any): Promise<unknown> },
    private readonly options: { observeNavigations?: boolean; getTab?: (id: number) => Promise<any>; getSiteInstruction?: (id: number, url: string) => string | undefined; accessibilityCore?: any } = {}
  ) { if (options.observeNavigations !== false) this.startObserving() }
  currentState(tabId: number): any {
    const sessionId = this.getSessionId()
    let tabs = this.sessions.get(sessionId)
    if (!tabs) { tabs = new Map(); this.sessions.set(sessionId, tabs) }
    let state = tabs.get(tabId)
    if (!state) {
      state = { tabId, initialized: false, revision: 0, navigationRevision: 0,
        loading: false, committed: false, painted: false,
        enabledTargets: new Set<string>(), frames: new Map<string, any>(), targets: new Map<string, any>() }
      tabs.set(tabId, state)
    }
    return state
  }
  startObserving() {
    if (this.removeTabCleanupHandler) return
    this.cdp.on('event', this.handleCdpEvent)
    this.cdp.on('tabDetached', this.handleTabDetached)
    this.removeTabCleanupHandler = this.cdp.addTabCleanupHandler((id: number) => this.handleTabDetached(id))
  }
  async capture(tabId: number, mode: string, options: any, screenshot: () => Promise<{ data?: Uint8Array }> = async () => { throw Error('Screenshot capture was not provided') }): Promise<any> {
    if (mode === 'screenshot' && !this.sessions.get(this.getSessionId())?.has(tabId) && !this.cdp.getJsDialog(tabId))
      return { data: (await screenshot()).data }
    const state = await this.ensureTracked(tabId)
    this.throwPendingError(tabId)
    let pending = state.pendingNavigationState
    if (pending && mode === 'screenshot') {
      let current = this.navigationState(state)
      if (pending.loading || pending.navigationRevision !== current.navigationRevision || pending.documentId !== current.documentId) {
        await new Promise(resolve => setTimeout(resolve, 250))
        this.throwPendingError(tabId)
        current = this.navigationState(state)
      }
      if (!pending.loading && pending.navigationRevision === current.navigationRevision && pending.documentId === current.documentId) {
        const value = this.commitCapture(state, await this.captureCandidate(state, mode, screenshot, options))
        if (value) return value
      }
    }
    if (!pending) {
      const current = this.navigationState(state)
      if (!current.loading) {
        const value = this.commitCapture(state, await this.captureCandidate(state, mode, screenshot, options))
        if (value) return value
      }
      pending = current; state.pendingNavigationState = current
    }
    let current = await this.waitForNavigation(state, pending)
    let navigated = pending.loading || pending.navigationRevision !== current.navigationRevision
    if (navigated) current = await this.waitForFirstPaint(state, current)
    current = await this.waitForAXQuiet(state, current, navigated)
    let probed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      const capture = await this.captureCandidate(state, mode, screenshot, options)
      this.throwPendingError(tabId)
      const candidate = capture.candidate
      if (!candidate && mode !== 'screenshot') throw Error('Accessibility capture was empty')
      let latest = this.navigationState(state)
      if (candidate && navigated && !probed && candidate.elementCount < 100) {
        const probe = await this.probeNavigationState(state)
        if (probe.documentElementCount != null && probe.documentElementCount >= Math.max(150, candidate.elementCount * 3) ||
          candidate.elementCount < 50 && (probe.documentTextLength ?? 0) >= 4000) {
          probed = true; await new Promise(resolve => setTimeout(resolve, 100)); this.throwPendingError(tabId); current = probe; continue
        }
        latest = probe
      }
      let usable = false
      if (candidate) {
        let urlMatches = true
        if (candidate.url != null && latest.url != null) {
          try { const first = new URL(candidate.url), second = new URL(latest.url); urlMatches = first.hostname === second.hostname && first.pathname === second.pathname }
          catch { urlMatches = candidate.url === latest.url }
        }
        usable = (latest.painted || latest.tabStatus === 'complete') && candidate.elementCount >= 10 && urlMatches
      } else usable = latest.revision === current.revision && (latest.painted || latest.tabStatus === 'complete' || capture.screenshotUnavailable != null)
      if ((!latest.loading && latest.revision === current.revision) || usable) {
        const result = this.commitCapture(state, capture)
        if (result) return result
        navigated = true
        current = await this.waitForAXQuiet(state, await this.waitForFirstPaint(state, this.navigationState(state)), true)
        continue
      }
      current = latest.loading || latest.navigationRevision !== current.navigationRevision ? await this.waitForFirstPaint(state, latest) : latest
    }
    const result = this.commitCapture(state, await this.captureCandidate(state, mode, screenshot, options))
    if (!result) throw Error('Accessibility capture changed before it was committed')
    return result
  }
  async captureCandidate(state: any, mode: string, screenshot: () => Promise<{ data?: Uint8Array }>, options: any): Promise<any> {
    const key = documentKey(state.mainFrameId, state.loaderId)
    const dialog = this.cdp.getJsDialog(state.tabId)
    if (dialog && dialog.type !== 'beforeunload') {
      const warning = `Screenshot unavailable while a JavaScript ${dialog.type} dialog is open. Use tab.ax.get("state") and tab.ax.click(elementIndex) to interact with its controls.`
      if (mode === 'screenshot') return { documentKey: key, screenshotUnavailable: warning }
      const candidate = await this.captureJavaScriptDialog(state, this.cdp.activeJsDialog(state.tabId, dialog.id), options)
      return mode === 'axState' ? { candidate, documentKey: key } :
        { candidate: { ...candidate, rendered: `${candidate.rendered}\n\n${warning}` }, documentKey: key, screenshotUnavailable: warning }
    }
    const [candidate, image] = await Promise.all([
      mode === 'screenshot' ? undefined : this.captureAX(state, options),
      mode === 'axState' ? undefined : screenshot()
    ])
    return { candidate, data: image?.data, documentKey: key }
  }
  async captureAX(state: any, options: any) {
    const [{ frameTree }, tab, snapshot] = await Promise.all([
      this.cdp.call(state.tabId, 'Page.getFrameTree'),
      this.options.getTab?.(state.tabId),
      this.cdp.callTarget({ tabId: state.tabId }, 'DOMSnapshot.captureSnapshot',
        { computedStyles: [], includePaintOrder: false, includeDOMRects: false })
    ])
    const warnings: string[] = []
    const sessions = await this.captureSessions(state, frameTree, snapshot, warnings)
    const documents = await this.captureDocuments(state, sessions, warnings)
    const nodes = mergeAxDocuments(documents, warnings)
    const frames = new Map(documents.map((item: any) => [item.frame.frameId, item.frame]))
    const byFrame = new Map(documents.map((item: any) => [item.frame.frameId, item]))
    const targets = new Map<string, any>()
    const renderNodes: any[] = []
    for (const node of nodes) {
      const { frameId, ...coreNode } = node
      const document = byFrame.get(frameId)
      if (!document) continue
      renderNodes.push(coreNode)
      if (node.backendDOMNodeID != null) targets.set(axIdentity(state.tabId, coreNode), {
        actionDescriptions: coreNode.properties.expanded?.value === true ? ['Collapse'] : coreNode.properties.expanded?.value === false ? ['Expand'] : [],
        target: document.frame.target, backendNodeId: node.backendDOMNodeID,
        isOptionElement: document.metadata.get(node.backendDOMNodeID)?.tagName === 'option',
        frameId: document.frame.frameId, loaderId: document.frame.loaderId
      })
    }
    const input = { capturedAt: new Date().toISOString(), tab: { id: state.tabId,
      title: tab?.title ?? null, url: tab?.url ?? frameTree.frame.url ?? state.url ?? null,
      active: tab?.active ?? false }, nodes: renderNodes, warnings }
    const core = this.options.accessibilityCore
    if (!core) throw Error('Browser accessibility WebAssembly runtime is not loaded')
    const revision = core.buildRevision(state.accessibilityRevision, input,
      { mode: options.disableDiffing ? 'full' : 'auto' })
    return { tab: input.tab, rendered: revision.text, elementCount: renderNodes.length,
      url: frameTree.frame.url, documentKey: documentKey(frameTree.frame.id, frameTree.frame.loaderId),
      frames, targets, accessibilityRevision: revision }
  }
  async captureJavaScriptDialog(state: any, dialog: any, options: any) {
    const tab = await this.options.getTab?.(state.tabId)
    const value = (item: any) => ({ value: item, relatedNodes: [] })
    const node = (parentIndex: number, suffix: string, role: string, name: string, rest: any = {}) => ({
      parentIndex, nodeID: `javascript-dialog:${dialog.id}:${suffix}`, role, chromeRole: null,
      name, nameSource: 'attribute', description: null, value: null, properties: {},
      dom: { bounds: null, identifier: null, className: null, declaredRole: role, hasAriaDescription: null, tagName: null },
      backendDOMNodeID: null, targetID: null, ...rest
    })
    const origin = URL.canParse(dialog.url) ? new URL(dialog.url) : null
    const nodes: any[] = [
      node(-1, 'root', 'RootWebArea', tab?.title ?? 'Web page'),
      node(0, 'dialog', 'alertdialog', origin?.host ? `${origin.host} says` : 'This page says', { properties: { modal: value(true) } }),
      node(1, 'message', 'StaticText', dialog.message)
    ]
    if (dialog.type === 'prompt') nodes.push(node(1, 'prompt', 'textbox', 'Response', { value: dialog.promptText,
      properties: { editable: value('plaintext'), focusable: value(true), focused: value(true), settable: value(true) },
      dialogTarget: { dialogID: dialog.id, control: 'prompt' } }))
    if (dialog.type !== 'alert') nodes.push(node(1, 'dismiss', 'button', dialog.type === 'beforeunload' ? 'Stay' : 'Cancel', {
      properties: { focusable: value(true) }, dialogTarget: { dialogID: dialog.id, control: 'dismiss' } }))
    nodes.push(node(1, 'accept', 'button', dialog.type === 'beforeunload' ? 'Leave' : 'OK', {
      properties: { focusable: value(true), focused: value(dialog.type !== 'prompt') },
      dialogTarget: { dialogID: dialog.id, control: 'accept' } }))
    const input = { capturedAt: new Date().toISOString(), tab: { id: state.tabId, title: tab?.title ?? null,
      url: tab?.url ?? (dialog.url || state.url) ?? null, active: tab?.active ?? false }, nodes, warnings: [] }
    const frameId = state.mainFrameId ?? `javascript-dialog:${dialog.id}`
    const frame = { frameId, loaderId: state.loaderId, target: dialog.target }
    const targets = new Map<string, any>()
    for (const item of nodes) if (['accept', 'dismiss', 'prompt'].includes(item.dialogTarget?.control))
      targets.set(axIdentity(state.tabId, item), { actionDescriptions: [], backendNodeId: 0, frameId,
        javaScriptDialog: { dialogID: item.dialogTarget.dialogID, control: item.dialogTarget.control },
        loaderId: state.loaderId, target: dialog.target })
    const core = this.options.accessibilityCore
    if (!core) throw Error('Browser accessibility WebAssembly runtime is not loaded')
    const revision = core.buildRevision(state.accessibilityRevision, input, { mode: options.disableDiffing ? 'full' : 'auto' })
    return { tab: input.tab, rendered: revision.text, elementCount: nodes.length, url: input.tab.url ?? undefined,
      documentKey: documentKey(state.mainFrameId, state.loaderId), frames: new Map([[frameId, frame]]),
      targets, accessibilityRevision: revision }
  }
  async captureSessions(state: any, frameTree: any, snapshot: any, warnings: string[]): Promise<any[]> {
    const sessions = [{ target: { tabId: state.tabId }, targetId: `tab:${state.tabId}`,
      actionTargetId: null, frameTree, domSnapshot: snapshot }]
    const seen = new Set([frameTree.frame.id]), deadline = Date.now() + 1000
    for (const session of sessions) for (const document of (session as any).domSnapshot.documents ?? []) {
      const parentFrameId = (session as any).domSnapshot.strings[document.frameId] || (session as any).frameTree.frame.id
      const embedded = new Set(document.nodes.contentDocumentIndex?.index ?? [])
      for (let index = 0; index < (document.nodes.nodeName?.length ?? 0); index++) {
        const name = (session as any).domSnapshot.strings[document.nodes.nodeName[index]]
        if (!['IFRAME', 'FRAME'].includes(name) || embedded.has(index)) continue
        const owner = document.nodes.backendNodeId?.[index]
        if (owner == null) continue
        if (Date.now() >= deadline) { warnings.push(`Iframe in ${parentFrameId} accessibility unavailable: traversal deadline exceeded`); return sessions }
        const timeout = { deadlineMs: deadline, preserveDebuggerOnTimeout: true, timeoutMs: Math.min(500, deadline - Date.now()) }
        let frameId: string | undefined
        try {
          frameId = (await this.cdp.callTarget((session as any).target, 'DOM.describeNode', { backendNodeId: owner }, timeout)).node.frameId
          if (!frameId || seen.has(frameId)) continue
          const target = await this.cdp.targetForFrameOrAttach(state.tabId, frameId, timeout)
          if (!target) throw Error('Debugger target is unavailable')
          const { frameTree: childTree } = await this.cdp.callTarget(target, 'Page.getFrameTree', undefined, timeout)
          if (childTree.frame.id !== frameId || childTree.frame.parentId != null && childTree.frame.parentId !== parentFrameId)
            throw Error('Debugger target does not match its parent frame')
          await this.enableAccessibility(state, target, timeout)
          const childSnapshot = await this.cdp.callTarget(target, 'DOMSnapshot.captureSnapshot',
            { computedStyles: [], includePaintOrder: false, includeDOMRects: false }, timeout)
          const targetId = this.cdp.targetIdForFrame(state.tabId, frameId) ?? target.targetId ?? frameId
          seen.add(frameId)
          sessions.push({ target, targetId, actionTargetId: targetId, parentFrameId, frameTree: childTree, domSnapshot: childSnapshot } as any)
        } catch (error) { warnings.push(`Iframe ${frameId ?? parentFrameId} accessibility unavailable: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    return sessions
  }
  async captureDocuments(state: any, sessions: any[], warnings: string[]): Promise<any[]> {
    const sessionRoots = new Set(sessions.map(session => session.frameTree.frame.id))
    const frames = new Map<string, any>(), owners = new Map<string, any>()
    for (const session of sessions) {
      const visit = (tree: any, parentId?: string) => {
        const id = tree.frame.id
        const parentFrameId = tree.frame.parentId ?? frames.get(id)?.parentFrameId ??
          (id === session.frameTree.frame.id ? session.parentFrameId : parentId)
        frames.set(id, { frameId: id, target: session.target, loaderId: tree.frame.loaderId, parentFrameId })
        if (id !== session.frameTree.frame.id && sessionRoots.has(id)) return
        owners.set(id, session)
        for (const child of tree.childFrames ?? []) visit(child, id)
      }
      visit(session.frameTree)
    }
    const depth = (frame: any) => {
      const seen = new Set<string>(); let current = frame, count = 0
      while (current?.parentFrameId && !seen.has(current.frameId)) { seen.add(current.frameId); count++; current = frames.get(current.parentFrameId) }
      return count
    }
    const ordered = [...frames.values()].sort((left, right) => depth(left) - depth(right))
    const captured = await Promise.all(ordered.map(async frame => {
      const session = owners.get(frame.frameId)
      if (!session) return undefined
      try {
        const { nodes } = await this.cdp.callTarget(session.target, 'Accessibility.getFullAXTree', { frameId: frame.frameId })
        const ids = new Set<number>(nodes.map((node: any) => node.backendDOMNodeId).filter((id: any) => id != null))
        const metadata = axSnapshotMetadata(session.domSnapshot, ids)
        if (frame.parentFrameId) {
          const parent = frames.get(frame.parentFrameId)
          if (!parent) throw Error(`Parent frame ${frame.parentFrameId} has no debugger session`)
          frame.ownerBackendNodeId = (await this.cdp.callTarget(parent.target, 'DOM.getFrameOwner', { frameId: frame.frameId })).backendNodeId
        }
        return { frame, targetId: session.targetId, actionTargetId: session.actionTargetId, nodes, metadata }
      } catch (error) {
        if (!frame.parentFrameId) throw error
        return { frameId: frame.frameId, error }
      }
    }))
    const result: any[] = []
    for (const item of captured) {
      if (!item) continue
      if ('error' in item) { warnings.push(`Iframe ${item.frameId} accessibility unavailable: ${item.error instanceof Error ? item.error.message : String(item.error)}`); continue }
      if (item.frame.parentFrameId) {
        const parent = result.find(other => other.frame.frameId === item.frame.parentFrameId)
        const bounds = parent?.metadata.get(item.frame.ownerBackendNodeId)?.bounds
        if (bounds) item.frame.size = { width: bounds[2], height: bounds[3] }
      }
      result.push(item)
    }
    this.throwPendingError(state.tabId)
    return result
  }
  commitCapture(state: any, capture: any) {
    this.throwPendingError(state.tabId)
    if (this.sessions.get(this.getSessionId())?.get(state.tabId) !== state) throw new StaleAxCaptureError()
    const candidate = capture.candidate
    const key = documentKey(state.mainFrameId, state.loaderId)
    if (capture.documentKey !== key || candidate && candidate.documentKey !== key) return undefined
    if (candidate) {
      state.documentKey = candidate.documentKey
      state.frames = candidate.frames
      state.targets = candidate.targets
      state.accessibilityRevision = candidate.accessibilityRevision
      state.pendingNavigationState = undefined
    }
    let rendered: string | undefined
    if (candidate) {
      const tab = candidate.tab
      const instruction = candidate.url != null && candidate.url === tab.url ? this.options.getSiteInstruction?.(tab.id, candidate.url) : undefined
      const suffix = instruction ? `, Site Specific Instructions: ${JSON.stringify(instruction)}` : ''
      rendered = `Browser tab: ${tab.id}, Title: ${JSON.stringify(tab.title ?? 'Unknown')}, URL: ${JSON.stringify(tab.url ?? 'Unknown')}${suffix}.\n${candidate.rendered}`
    }
    const result = { ...(rendered == null ? {} : { state: rendered }), ...(capture.data == null ? {} : { data: capture.data }),
      ...(capture.screenshotUnavailable == null ? {} : { screenshot_unavailable: capture.screenshotUnavailable }) }
    this.captureProvenance.set(result, { sessionId: this.getSessionId(), documentKey: capture.documentKey, state })
    return result
  }
  async waitForNavigation(state: any, original: any) {
    const started = Date.now()
    let current = original
    if (!original.loading) for (; Date.now() - started < 25; ) {
      this.throwPendingError(state.tabId)
      current = this.navigationState(state)
      if (current.loading || current.revision !== original.revision) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (!current.loading || current.committed) return current
    for (; Date.now() - started < 5000; ) {
      this.throwPendingError(state.tabId); current = this.navigationState(state)
      if (!current.loading || current.committed) return current
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return current
  }
  async waitForFirstPaint(state: any, original: any) {
    if (!original.committed || original.painted || original.javaScriptDialogId != null) return original
    const until = Date.now() + 5000
    let current = original
    while (Date.now() < until) {
      this.throwPendingError(state.tabId); current = this.navigationState(state)
      if (current.painted || current.tabStatus === 'complete') return current
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return current
  }
  async waitForAXQuiet(state: any, original: any, navigated: boolean) {
    const started = Date.now(), until = started + 750, quiet = navigated ? 50 : 100
    let current = original
    for (;;) {
      this.throwPendingError(state.tabId)
      if (Date.now() - Math.max(started, current.lastAXUpdateMilliseconds ?? started) >= quiet || Date.now() >= until) return current
      await new Promise(resolve => setTimeout(resolve, 25))
      current = this.navigationState(state)
    }
  }
  async probeNavigationState(state: any): Promise<any> {
    const current = this.navigationState(state)
    if (current.javaScriptDialogId != null) return current
    const probe = await this.cdp.evaluateJavascript(state.tabId,
      "(() => { const body = document.body; return { readyState: document.readyState, elementCount: body?.querySelectorAll('*').length ?? 0, textLength: body?.innerText?.length ?? 0 }; })()"
    ).catch(() => undefined)
    return { ...current, documentElementCount: probe?.elementCount, documentTextLength: probe?.textLength,
      tabStatus: probe?.readyState === 'complete' ? 'complete' : current.tabStatus }
  }
  dispose() {
    if (this.removeTabCleanupHandler) {
      this.cdp.removeListener('event', this.handleCdpEvent)
      this.cdp.removeListener('tabDetached', this.handleTabDetached)
      this.removeTabCleanupHandler()
    }
    this.sessions.clear()
  }
  targetForElement(tabId: number, index: number) {
    const state = this.currentState(tabId)
    const identity = state.accessibilityRevision?.identityForElement(index)
    const target = identity == null ? undefined : state.targets.get(identity)
    if (target == null || (target.javaScriptDialog && this.cdp.getJsDialog(tabId)?.id !== target.javaScriptDialog.dialogID))
      throw Error(`Accessibility element ${index} is stale or missing`)
    if (state.documentKey !== documentKey(state.mainFrameId, state.loaderId))
      throw Error(`Accessibility element ${index} belongs to a previous page`)
    return { ...target, id: index, isValueSettable: state.accessibilityRevision?.isValueSettableForElement?.(index) }
  }
  frameForId(tabId: number, frameId: string) { return this.currentState(tabId).frames.get(frameId) }
  trackDeferredPageLoad(tabId: number, load: Promise<unknown>) {
    const state = this.currentState(tabId)
    load.catch(error => { state.pendingError ??= error })
  }
  throwPendingError(tabId: number) {
    const state = this.currentState(tabId)
    if (state.pendingError != null) {
      const error = state.pendingError
      state.pendingError = undefined
      throw error
    }
  }
  validateCapture(tabId: number, capture: object) {
    const session = this.getSessionId()
    const state = this.sessions.get(session)?.get(tabId)
    if (state) this.throwPendingError(tabId)
    const provenance = this.captureProvenance.get(capture)
    if (provenance && (!state || provenance.state !== state || provenance.sessionId !== session ||
      provenance.documentKey !== documentKey(state.mainFrameId, state.loaderId))) throw new StaleAxCaptureError()
  }
  navigationState(state: any) {
    return { tabId: state.tabId, revision: state.revision, navigationRevision: state.navigationRevision,
      loading: state.loading, committed: state.committed, painted: state.painted,
      tabStatus: state.tabStatus, url: state.url, documentId: state.loaderId,
      javaScriptDialogId: this.cdp.getJsDialog(state.tabId)?.id,
      lastAXUpdateMilliseconds: state.lastAXUpdateMilliseconds }
  }
  async prepareAction(tabId: number) {
    const state = await this.ensureTracked(tabId)
    this.throwPendingError(tabId)
    return this.navigationState(state)
  }
  async performAction(tabId: number, action: any) {
    const before = await this.prepareAction(tabId)
    await this.actions.perform(tabId, action)
    if ((action.kind === 'set_value' || action.kind === 'type_text') && this.cdp.getJsDialog(tabId)?.type === 'prompt')
      this.currentState(tabId).revision += 1
    this.markActionCompleted(tabId, before)
  }
  markActionCompleted(tabId: number, before: any) {
    this.currentState(tabId).pendingNavigationState = before
    this.throwPendingError(tabId)
  }
  async ensureTracked(tabId: number): Promise<any> {
    this.startObserving()
    const state = this.currentState(tabId)
    if (state.initialized) return state
    const { frameTree } = await this.cdp.call(tabId, 'Page.getFrameTree')
    state.mainFrameId = frameTree.frame.id
    state.loaderId = frameTree.frame.loaderId
    state.url = frameTree.frame.url
    state.committed = true
    await Promise.all([
      this.enableAccessibility(state, { tabId }),
      this.cdp.call(tabId, 'Page.setLifecycleEventsEnabled', { enabled: true })
    ])
    if (!this.cdp.getJsDialog(tabId)) {
      const document = await this.cdp.readDocumentState(tabId, { includePaint: true })
      if (document?.href != null) state.url = document.href
      if (document?.painted) state.painted = true
      if (document?.readyState === 'complete') { state.tabStatus = 'complete'; state.painted = true }
      else if (document?.readyState != null) { state.loading = true; state.tabStatus = 'loading' }
    }
    state.initialized = true
    return state
  }
  async enableAccessibility(state: any, target: any, options?: any) {
    const key = targetKey(target)
    if (state.enabledTargets.has(key)) return
    await this.cdp.callTarget(target, 'Accessibility.enable', undefined, options)
    state.enabledTargets.add(key)
  }
  invalidateFrame(state: any, frameId: string) {
    const removed = new Set([frameId])
    for (const [id, frame] of state.frames) if (frame.parentFrameId && removed.has(frame.parentFrameId)) removed.add(id)
    for (const id of removed) state.frames.delete(id)
    for (const [id, target] of state.targets) if (removed.has(target.frameId)) state.targets.delete(id)
  }
  handleTabDetached = (tabId: number) => { for (const tabs of this.sessions.values()) tabs.delete(tabId) }
  handleCdpEvent = (event: any) => {
    let state: any
    try { state = this.sessions.get(this.getSessionId())?.get(event.source.tabId) } catch { return }
    if (!state) {
      if (event.method !== 'Page.frameNavigated' || event.source.sessionId != null || event.source.targetId != null || event.params.frame.parentId != null) return
      state = this.currentState(event.source.tabId)
      state.pendingNavigationState = this.navigationState(state)
    }
    if (event.method === 'Accessibility.loadComplete' || event.method === 'Accessibility.nodesUpdated') {
      if (state.enabledTargets.has(targetKey(event.source))) state.lastAXUpdateMilliseconds = Date.now()
      return
    }
    if (event.method === 'Page.frameNavigated' && (event.source.sessionId != null || event.source.targetId != null || event.params.frame.parentId != null)) {
      this.invalidateFrame(state, event.params.frame.id); return
    }
    if (event.method === 'Page.frameDetached') { this.invalidateFrame(state, event.params.frameId); return }
    if (event.method === 'Target.detachedFromTarget') {
      const key = targetKey({ tabId: state.tabId, sessionId: event.params.sessionId })
      state.enabledTargets.delete(key)
      for (const frame of [...state.frames.values()]) if (frame.target.sessionId === event.params.sessionId) this.invalidateFrame(state, frame.frameId)
      return
    }
    if (event.method === 'Page.javascriptDialogOpening' || event.method === 'Page.javascriptDialogClosed') { state.revision += 1; return }
    if (event.source.sessionId != null || event.source.targetId != null) return
    switch (event.method) {
      case 'Page.frameStartedLoading':
        if (event.params.frameId === state.mainFrameId) {
          if (!state.loading) state.provisionalNavigation = { navigationRevision: state.navigationRevision, committed: state.committed,
            painted: state.painted, tabStatus: state.tabStatus, documentId: state.loaderId }
          this.beginNavigation(state)
        }
        break
      case 'Page.frameNavigated':
        state.pendingNavigationState ??= this.navigationState(state)
        state.provisionalNavigation = undefined
        if (!state.loading) this.beginNavigation(state)
        state.mainFrameId = event.params.frame.id; state.loaderId = event.params.frame.loaderId
        state.url = event.params.frame.url; state.committed = true
        if (event.params.type === 'BackForwardCacheRestore') { state.loading = false; state.painted = true }
        break
      case 'Page.navigatedWithinDocument':
        if (event.params.frameId !== state.mainFrameId) break
        if (state.provisionalNavigation?.documentId === state.loaderId) {
          const prior = state.provisionalNavigation
          state.revision -= 1; state.navigationRevision = prior.navigationRevision
          state.committed = prior.committed; state.painted = prior.painted; state.tabStatus = prior.tabStatus
          state.provisionalNavigation = undefined
        }
        state.loading = false; state.url = event.params.url
        if (event.params.navigationType !== 'fragment') { state.pendingNavigationState ??= this.navigationState(state); state.revision += 1 }
        break
      case 'Page.domContentEventFired': state.loading = false; break
      case 'Page.loadEventFired': state.loading = false; state.tabStatus = 'complete'; break
      case 'Page.frameStoppedLoading': if (event.params.frameId === state.mainFrameId) state.loading = false; break
      case 'Page.lifecycleEvent':
        if (state.committed && event.params.frameId === state.mainFrameId &&
          (state.loaderId == null || event.params.loaderId === state.loaderId) &&
          new Set(['firstPaint', 'firstContentfulPaint']).has(event.params.name)) state.painted = true
    }
  }
  private beginNavigation(state: any) {
    if (!state.loading) { state.revision += 1; state.navigationRevision += 1 }
    state.loading = true; state.committed = false; state.painted = false; state.tabStatus = 'loading'
  }
}
