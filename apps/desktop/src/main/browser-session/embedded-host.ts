import { randomUUID } from 'node:crypto'
import type { BrowserWindow, WebContentsView } from 'electron'
import type { BrowserDesktopHostSession, BrowserSessionCommand } from '@action-driver/browser-desktop'
import { formatBrowserAXTree } from './ax-state.js'

type ViewOptions = ConstructorParameters<typeof WebContentsView>[0]
type ViewFactory = (options: ViewOptions) => WebContentsView
type Bounds = { x: number; y: number; width: number; height: number }

function safeUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch { return false }
}

/** Owns only pages created for the right-hand browser panel. */
export function createEmbeddedBrowserHost(
  window: Pick<BrowserWindow, 'contentView'>,
  createView: ViewFactory,
  onChanged: () => void = () => {}
): BrowserDesktopHostSession & { setViewport(bounds: Bounds, visible: boolean): void } {
  const tabs = new Map<string, WebContentsView>()
  const partition = `action-driver-browser-${randomUUID()}`
  let activeTabId: string | null = null
  let viewport: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  let visible = false
  let closed = false
  const assertOpen = () => { if (closed) throw new Error('BROWSER_HOST_CLOSED') }
  const tab = (id: string) => {
    const view = tabs.get(id)
    if (!view) throw new Error('BROWSER_TAB_UNAVAILABLE')
    return view
  }
  const syncViews = () => {
    for (const [id, view] of tabs) {
      view.setBounds(id === activeTabId ? viewport : { x: 0, y: 0, width: 0, height: 0 })
      view.setVisible(visible && id === activeTabId && viewport.width > 0 && viewport.height > 0)
    }
  }
  const createTab = () => {
    assertOpen()
    const view = createView({ webPreferences: {
      partition, sandbox: true, nodeIntegration: false, contextIsolation: true,
      webSecurity: true
    } })
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (!safeUrl(url)) return { action: 'deny' }
      queueMicrotask(() => {
        if (closed) return
        const childId = createTab()
        onChanged()
        void tab(childId).webContents.loadURL(url).catch(() => onChanged())
      })
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event, url) => {
      if (!safeUrl(url)) event.preventDefault()
    })
    const changed = () => { if (!closed) onChanged() }
    view.webContents.on('did-navigate', changed)
    view.webContents.on('did-navigate-in-page', changed)
    view.webContents.on('page-title-updated', changed)
    view.webContents.on('did-start-loading', changed)
    view.webContents.on('did-stop-loading', changed)
    const id = randomUUID()
    tabs.set(id, view)
    window.contentView.addChildView(view)
    activeTabId = id
    syncViews()
    return id
  }
  createTab()
  return {
    setViewport(bounds, show) {
      assertOpen()
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
          bounds.width < 0 || bounds.height < 0) throw new Error('BROWSER_VIEWPORT_INVALID')
      if (viewport.x === bounds.x && viewport.y === bounds.y &&
          viewport.width === bounds.width && viewport.height === bounds.height &&
          visible === show) return
      viewport = { ...bounds }
      visible = show
      syncViews()
    },
    async snapshot() {
      assertOpen()
      return { activeTabId, tabs: [...tabs].map(([id, view]) => ({
        id, title: view.webContents.getTitle(), url: view.webContents.getURL(),
        loading: view.webContents.isLoading(), canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })) }
    },
    async execute(tabId: string, command: BrowserSessionCommand) {
      assertOpen()
      const view = tab(tabId)
      const contents = view.webContents
      switch (command.type) {
        case 'create-tab': return createTab()
        case 'select-tab': activeTabId = tabId; syncViews(); return undefined
        case 'close-tab':
          tabs.delete(tabId)
          window.contentView.removeChildView(view)
          contents.close()
          if (activeTabId === tabId) activeTabId = tabs.keys().next().value ?? null
          if (tabs.size === 0) createTab()
          syncViews()
          return undefined
        case 'navigate':
          if (!safeUrl(command.url)) throw new Error('BROWSER_URL_INVALID')
          await contents.loadURL(command.url)
          return undefined
        case 'back': if (contents.canGoBack()) contents.goBack(); return undefined
        case 'forward': if (contents.canGoForward()) contents.goForward(); return undefined
        case 'refresh': contents.reload(); return undefined
        case 'click':
          contents.focus()
          {
            const debuggerApi = contents.debugger
            const button = command.button === 2 ? 'middle' : command.button === 3 ? 'right' : 'left'
            const attached = debuggerApi.isAttached()
            if (!attached) debuggerApi.attach('1.3')
            try {
              await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: command.x, y: command.y
              })
              await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
                type: 'mousePressed', x: command.x, y: command.y,
                button, clickCount: 1
              })
              await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
                type: 'mouseReleased', x: command.x, y: command.y,
                button, clickCount: 1
              })
            } finally {
              if (!attached && debuggerApi.isAttached()) debuggerApi.detach()
            }
          }
          return undefined
        case 'type': {
          const debuggerApi = contents.debugger
          const attached = debuggerApi.isAttached()
          if (!attached) debuggerApi.attach('1.3')
          try { await debuggerApi.sendCommand('Input.insertText', { text: command.text }) }
          finally { if (!attached && debuggerApi.isAttached()) debuggerApi.detach() }
          return undefined
        }
        case 'double-click':
        case 'move':
        case 'drag': {
          const debuggerApi = contents.debugger
          const attached = debuggerApi.isAttached()
          if (!attached) debuggerApi.attach('1.3')
          const move = (x: number, y: number, buttons = 0) =>
            debuggerApi.sendCommand('Input.dispatchMouseEvent', {
              type: 'mouseMoved', x, y, buttons
            })
          const press = (type: 'mousePressed' | 'mouseReleased', x: number, y: number,
            clickCount: number) => debuggerApi.sendCommand('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', clickCount
          })
          try {
            contents.focus()
            if (command.type === 'move') await move(command.x, command.y)
            if (command.type === 'double-click') {
              await move(command.x, command.y)
              for (const count of [1, 2]) {
                await press('mousePressed', command.x, command.y, count)
                await press('mouseReleased', command.x, command.y, count)
              }
            }
            if (command.type === 'drag') {
              const [first, ...rest] = command.path
              if (!first || rest.length === 0) throw new Error('BROWSER_DRAG_PATH_REQUIRED')
              await move(first.x, first.y)
              await press('mousePressed', first.x, first.y, 1)
              try { for (const point of rest) await move(point.x, point.y, 1) }
              finally {
                const last = rest.at(-1)!
                await press('mouseReleased', last.x, last.y, 1)
              }
            }
          } finally {
            if (!attached && debuggerApi.isAttached()) debuggerApi.detach()
          }
          return undefined
        }
        case 'keypress': {
          if (command.keys.length !== 1) throw new Error('BROWSER_KEY_COMBINATION_UNAVAILABLE')
          const keyCode = command.keys[0] === 'ENTER' ? 'Enter' : command.keys[0]!
          contents.focus()
          contents.sendInputEvent({ type: 'keyDown', keyCode })
          contents.sendInputEvent({ type: 'keyUp', keyCode })
          return undefined
        }
        case 'scroll':
          contents.sendInputEvent({ type: 'mouseWheel', x: command.x, y: command.y,
            deltaX: command.deltaX, deltaY: command.deltaY })
          return undefined
        case 'screenshot': {
          if (command.fullPage) {
            const debuggerApi = contents.debugger
            const attached = debuggerApi.isAttached()
            if (!attached) debuggerApi.attach('1.3')
            try {
              const captured = await debuggerApi.sendCommand('Page.captureScreenshot', {
                format: 'png', captureBeyondViewport: true,
                ...(command.clip ? { clip: { ...command.clip, scale: 1 } } : {})
              }) as { data?: string }
              if (typeof captured.data !== 'string') throw new Error('BROWSER_SCREENSHOT_INVALID')
              return { mimeType: 'image/png', bytes: Buffer.from(captured.data, 'base64') }
            } finally {
              if (!attached && debuggerApi.isAttached()) debuggerApi.detach()
            }
          }
          const image = await contents.capturePage(command.clip)
          return { mimeType: 'image/png', bytes: image.toPNG() }
        }
        case 'ax-state': {
          const debuggerApi = contents.debugger
          const attached = debuggerApi.isAttached()
          if (!attached) debuggerApi.attach('1.3')
          try {
            const result = await debuggerApi.sendCommand('Accessibility.getFullAXTree') as {
              nodes?: Parameters<typeof formatBrowserAXTree>[0]
            }
            return formatBrowserAXTree(result.nodes ?? [])
          } finally {
            if (!attached && debuggerApi.isAttached()) debuggerApi.detach()
          }
        }
      }
    },
    async close() {
      if (closed) return
      closed = true
      for (const view of tabs.values()) {
        window.contentView.removeChildView(view)
        view.webContents.close()
      }
      tabs.clear()
      activeTabId = null
    }
  }
}
