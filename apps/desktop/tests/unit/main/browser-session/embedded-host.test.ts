import { describe, expect, it, vi } from 'vitest'

describe('embedded browser host', () => {
  it('should skip native view updates when viewport state repeats', async () => {
    const setBounds = vi.fn()
    const setVisible = vi.fn()
    const { createEmbeddedBrowserHost } = await import('../../../../src/main/browser-session/embedded-host')
    const host = createEmbeddedBrowserHost({ contentView: {
      addChildView: vi.fn(), removeChildView: vi.fn()
    } } as never, () => ({
      setBounds, setVisible,
      webContents: {
        setWindowOpenHandler: vi.fn(), on: vi.fn(), close: vi.fn(),
        getTitle: () => '', getURL: () => '', isLoading: () => false,
        canGoBack: () => false, canGoForward: () => false
      }
    } as never))
    setBounds.mockClear()
    setVisible.mockClear()

    const initial = { x: 20, y: 30, width: 500, height: 400 }
    host.setViewport(initial, true)
    host.setViewport({ ...initial }, true)
    expect(setBounds).toHaveBeenCalledTimes(1)
    expect(setVisible).toHaveBeenCalledTimes(1)

    const resized = { ...initial, width: 600 }
    host.setViewport(resized, true)
    expect(setBounds).toHaveBeenLastCalledWith(resized)
    expect(setBounds).toHaveBeenCalledTimes(2)
    host.setViewport(resized, false)
    expect(setVisible).toHaveBeenLastCalledWith(false)
    expect(setVisible).toHaveBeenCalledTimes(3)
    await host.close()
  })

  it('should sync active view when tabs are created selected and closed', async () => {
    const views: Array<{ setBounds: ReturnType<typeof vi.fn>; setVisible: ReturnType<typeof vi.fn> }> = []
    const { createEmbeddedBrowserHost } = await import('../../../../src/main/browser-session/embedded-host')
    const host = createEmbeddedBrowserHost({ contentView: {
      addChildView: vi.fn(), removeChildView: vi.fn()
    } } as never, () => {
      const view = { setBounds: vi.fn(), setVisible: vi.fn() }
      views.push(view)
      return { ...view, webContents: {
        setWindowOpenHandler: vi.fn(), on: vi.fn(), close: vi.fn(),
        getTitle: () => '', getURL: () => '', isLoading: () => false,
        canGoBack: () => false, canGoForward: () => false
      } } as never
    })
    const firstId = (await host.snapshot()).activeTabId!
    const bounds = { x: 20, y: 30, width: 500, height: 400 }
    host.setViewport(bounds, true)

    await host.execute(firstId, { type: 'create-tab' })
    const secondId = (await host.snapshot()).activeTabId!
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(false)
    expect(views[1]!.setBounds).toHaveBeenLastCalledWith(bounds)
    expect(views[1]!.setVisible).toHaveBeenLastCalledWith(true)

    await host.execute(firstId, { type: 'select-tab' })
    expect(views[0]!.setVisible).toHaveBeenLastCalledWith(true)
    expect(views[1]!.setVisible).toHaveBeenLastCalledWith(false)

    await host.execute(firstId, { type: 'close-tab' })
    expect((await host.snapshot()).activeTabId).toBe(secondId)
    expect(views[1]!.setVisible).toHaveBeenLastCalledWith(true)
    await host.close()
  })

  it('creates an isolated managed view and releases it after navigation', async () => {
    const addChildView = vi.fn()
    const removeChildView = vi.fn()
    const setBounds = vi.fn()
    const setVisible = vi.fn()
    const loadURL = vi.fn(async () => undefined)
    const close = vi.fn()
    const preferences: unknown[] = []
    const window = { contentView: { addChildView, removeChildView } }
    const { createEmbeddedBrowserHost } = await import('../../../../src/main/browser-session/embedded-host')
    const host = createEmbeddedBrowserHost(window as never, (options) => {
      preferences.push(options)
      return {
        setBounds, setVisible,
        webContents: {
          loadURL, close,
          getURL: () => 'https://example.test/', getTitle: () => 'Example',
          canGoBack: () => false, canGoForward: () => false,
          isLoading: () => false,
          on: vi.fn(), setWindowOpenHandler: vi.fn()
        }
      } as never
    })
    const first = await host.snapshot()
    expect(first.tabs).toHaveLength(1)
    expect(preferences[0]).toMatchObject({ webPreferences: {
      sandbox: true, nodeIntegration: false, contextIsolation: true
    } })
    expect(preferences[0]).not.toHaveProperty('webPreferences.preload')
    expect(addChildView).toHaveBeenCalledOnce()
    host.setViewport({ x: 20, y: 30, width: 500, height: 400 }, true)
    expect(setBounds).toHaveBeenCalledWith({ x: 20, y: 30, width: 500, height: 400 })
    expect(setVisible).toHaveBeenCalledWith(true)
    await host.execute(first.activeTabId!, { type: 'navigate', url: 'https://example.test/' })
    expect(loadURL).toHaveBeenCalledWith('https://example.test/')
    await host.close()
    expect(removeChildView).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps permitted popup pages inside managed tabs', async () => {
    let handlePopup: ((details: { url: string }) => { action: string }) | undefined
    const onChanged = vi.fn()
    const { createEmbeddedBrowserHost } = await import('../../../../src/main/browser-session/embedded-host')
    const host = createEmbeddedBrowserHost({ contentView: {
      addChildView: vi.fn(), removeChildView: vi.fn()
    } } as never, () => ({
      setBounds: vi.fn(), setVisible: vi.fn(),
      webContents: {
        setWindowOpenHandler: (handler: typeof handlePopup) => { handlePopup = handler },
        on: vi.fn(), getTitle: () => '', getURL: () => '', isLoading: () => false,
        canGoBack: () => false, canGoForward: () => false, close: vi.fn(),
        loadURL: vi.fn(async () => undefined)
      }
    } as never), onChanged)
    expect(handlePopup?.({ url: 'file:///etc/passwd' }).action).toBe('deny')
    const permitted = handlePopup?.({ url: 'https://example.test/popup' })
    expect(permitted?.action).toBe('deny')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect((await host.snapshot()).tabs).toHaveLength(2)
    expect(onChanged).toHaveBeenCalled()
    await host.close()
  })
})
