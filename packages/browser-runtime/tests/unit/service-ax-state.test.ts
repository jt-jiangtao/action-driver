import { expect, test } from 'vitest'
import { AxState } from '../../src/service-ax-state'
import { originalDocumentation } from '../original-service'

async function pair() {
  const baseline = await originalDocumentation()
  const cdp = {
    on() {}, removeListener() {}, addTabCleanupHandler: () => () => {},
    getJsDialog: () => undefined
  }
  const actions = { perform: async () => undefined }
  return [
    new AxState(cdp, () => 'session-a', actions, { observeNavigations: false }),
    new baseline.BaselineAxState(cdp, () => 'session-a', actions, { observeNavigations: false })
  ]
}

test('element identity stays bound to its captured page and current dialog', async () => {
  for (const state of await pair()) {
    const tab = state.currentState(3)
    tab.mainFrameId = 'main'
    tab.loaderId = 'loader'
    tab.documentKey = 'main:loader'
    tab.accessibilityRevision = {
      identityForElement: (index: number) => index === 7 ? 'node-7' : undefined,
      isValueSettableForElement: () => true
    }
    tab.targets.set('node-7', { frameId: 'main', backendNodeId: 19, target: { tabId: 3 } })
    expect(state.targetForElement(3, 7)).toMatchObject({ id: 7, backendNodeId: 19, isValueSettable: true })
    expect(() => state.targetForElement(3, 8)).toThrow('Accessibility element 8 is stale or missing')
    tab.loaderId = 'next'
    expect(() => state.targetForElement(3, 7)).toThrow('Accessibility element 7 belongs to a previous page')
  }
})

test('session, deferred errors, and capture provenance invalidate stale observations', async () => {
  for (const state of await pair()) {
    const tab = state.currentState(3)
    tab.mainFrameId = 'main'; tab.loaderId = 'loader'
    const capture = {}
    state.captureProvenance.set(capture, { state: tab, sessionId: 'session-a', documentKey: 'main:loader' })
    state.validateCapture(3, capture)
    state.trackDeferredPageLoad(3, Promise.reject(Error('load failed')))
    await Promise.resolve(); await Promise.resolve()
    expect(() => state.throwPendingError(3)).toThrow('load failed')
    state.throwPendingError(3)
    tab.loaderId = 'next'
    expect(() => state.validateCapture(3, capture)).toThrow('Accessibility capture belongs to a previous page')
    state.dispose()
    expect(state.sessions.size).toBe(0)
  }
})

test('frame and AX events change only tracked session state', async () => {
  for (const state of await pair()) {
    const tab = state.currentState(3)
    tab.mainFrameId = 'main'; tab.loaderId = 'old'; tab.initialized = true
    tab.enabledTargets.add('3:root')
    tab.frames.set('child', { frameId: 'child', parentFrameId: 'main' })
    tab.targets.set('child-node', { frameId: 'child' })
    state.handleCdpEvent({ source: { tabId: 3 }, method: 'Accessibility.nodesUpdated', params: {} })
    expect(tab.lastAXUpdateMilliseconds).toBeTypeOf('number')
    state.handleCdpEvent({ source: { tabId: 3 }, method: 'Page.frameDetached', params: { frameId: 'child' } })
    expect([tab.frames.has('child'), tab.targets.has('child-node')]).toEqual([false, false])
    state.handleCdpEvent({ source: { tabId: 3 }, method: 'Page.frameNavigated', params: { frame: { id: 'main', loaderId: 'new', url: 'https://example.test' } } })
    expect([tab.loaderId, tab.navigationRevision, tab.loading, tab.committed]).toEqual(['new', 1, true, true])
  }
})

test('state capture commits revision, tab banner, site instructions, and provenance', async () => {
  for (const state of await pair()) {
    const tab = state.currentState(3)
    tab.initialized = true; tab.mainFrameId = 'main'; tab.loaderId = 'loader'
    const frame = { frameId: 'main', loaderId: 'loader', target: { tabId: 3 } }
    const revision = { identityForElement: () => undefined }
    state.captureCandidate = async () => ({
      documentKey: 'main:loader', candidate: {
        documentKey: 'main:loader', tab: { id: 3, title: 'Example', url: 'https://example.test' },
        url: 'https://example.test', rendered: 'button Submit', elementCount: 1,
        frames: new Map([['main', frame]]), targets: new Map(), accessibilityRevision: revision
      }
    })
    const result = await state.capture(3, 'axState', { disableDiffing: true })
    expect(result.state).toBe('Browser tab: 3, Title: "Example", URL: "https://example.test".\nbutton Submit')
    expect(tab.accessibilityRevision).toBe(revision)
    state.validateCapture(3, result)
    tab.loaderId = 'next'
    expect(() => state.validateCapture(3, result)).toThrow('Accessibility capture belongs to a previous page')
  }
})

test('screenshot before AX tracking bypasses page setup but preserves bytes', async () => {
  for (const state of await pair()) {
    const image = Uint8Array.of(1, 2, 3)
    const result = await state.capture(3, 'screenshot', {}, async () => ({ data: image }))
    expect(result).toEqual({ data: image })
    expect(state.sessions.size).toBe(0)
  }
})

test('single-frame AX snapshot builds revision and target identity from CDP nodes', async () => {
  const baseline = await originalDocumentation()
  const snapshot = { strings: ['f', 'BUTTON'], documents: [{ frameId: 0,
    nodes: { backendNodeId: [11], nodeName: [1], attributes: [[]] },
    layout: { nodeIndex: [0], bounds: [[5, 6, 70, 20]] }, scrollOffsetX: 0, scrollOffsetY: 0 }] }
  const tree = { frame: { id: 'f', loaderId: 'l', url: 'https://example.test' } }
  const nodes = [{ nodeId: '1', ignored: false, role: { value: 'button' }, chromeRole: { value: 'button' },
    name: { value: 'Go' }, backendDOMNodeId: 11, properties: [], childIds: [] }]
  for (const State of [AxState, baseline.BaselineAxState]) {
    let input: any
    const cdp = {
      on() {}, removeListener() {}, addTabCleanupHandler: () => () => {}, getJsDialog: () => undefined,
      call: async (_id: number, method: string) => method === 'Page.getFrameTree' ? { frameTree: tree } : undefined,
      callTarget: async (_target: any, method: string) => method === 'DOMSnapshot.captureSnapshot' ? snapshot : { nodes }
    }
    const core = { buildRevision: (_previous: any, value: any, options: any) => {
      input = { value, options }
      return { text: 'button Go', identityForElement: () => undefined }
    } }
    const state = new State(cdp, () => 's', { perform: async () => {} },
      { observeNavigations: false, getTab: async () => ({ title: 'Page', url: 'https://example.test' }), accessibilityCore: core })
    const result = await state.captureAX(state.currentState(3), { disableDiffing: true })
    expect(result).toMatchObject({ rendered: 'button Go', elementCount: 1, documentKey: 'f:l' })
    expect(input.options).toEqual({ mode: 'full' })
    expect(input.value.nodes[0]).toMatchObject({ role: 'button', backendDOMNodeID: 11 })
    expect(result.targets.size).toBe(1)
  }
})

test('prompt dialog capture exposes prompt and controls as AX nodes', async () => {
  const baseline = await originalDocumentation()
  for (const State of [AxState, baseline.BaselineAxState]) {
    let input: any
    const core = { buildRevision: (_previous: any, value: any) => { input = value; return { text: 'dialog', identityForElement: () => undefined } } }
    const cdp = { on() {}, removeListener() {}, addTabCleanupHandler: () => () => {}, getJsDialog: () => undefined }
    const state = new State(cdp, () => 's', { perform: async () => {} }, { observeNavigations: false,
      getTab: async () => ({ title: 'Page', url: 'https://example.test' }), accessibilityCore: core })
    const tab = state.currentState(3); tab.mainFrameId = 'f'; tab.loaderId = 'l'
    const dialog = { id: 'd1', type: 'prompt', message: 'Your name?', promptText: 'Ada',
      target: { tabId: 3 }, url: 'https://example.test' }
    const result = await state.captureJavaScriptDialog(tab, dialog, { disableDiffing: true })
    expect(input.nodes.map((node: any) => node.name)).toEqual(['Page', 'example.test says', 'Your name?', 'Response', 'Cancel', 'OK'])
    expect(result.targets.size).toBe(3)
    expect(result.documentKey).toBe('f:l')
  }
})
