import { describe, expect, it, vi } from 'vitest'
import { createLangSmithDetailHost } from './langsmith-detail-view'

function harness() {
  const children: unknown[] = []
  const navigation = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
  let newWindow: ((details: { url: string }) => { action: 'deny' }) | undefined
  const bounds = vi.fn()
  const loadURL = vi.fn(async () => {})
  const close = vi.fn()
  const view = {
    setBounds: bounds,
    webContents: {
      loadURL,
      close,
      setWindowOpenHandler(handler: typeof newWindow) {
        newWindow = handler
      },
      on(event: string, handler: (event: { preventDefault(): void }, url: string) => void) {
        navigation.set(event, handler)
      }
    }
  }
  const window = {
    contentView: {
      addChildView(child: unknown) {
        children.push(child)
      },
      removeChildView(child: unknown) {
        children.splice(children.indexOf(child), 1)
      }
    }
  }
  return {
    host: createLangSmithDetailHost(window, () => view),
    children,
    bounds,
    loadURL,
    close,
    navigate: () => navigation.get('will-navigate'),
    redirect: () => navigation.get('will-redirect'),
    newWindow: () => newWindow
  }
}

describe('LangSmith detail WebContentsView', () => {
  it('embeds a detail, repositions it and destroys it on close', async () => {
    const h = harness()
    const rect = { x: 24, y: 80, width: 800, height: 500 }
    await h.host.show('https://smith.langchain.com/o/test/r/1', rect)
    expect(h.children).toHaveLength(1)
    expect(h.loadURL).toHaveBeenCalledWith('https://smith.langchain.com/o/test/r/1')
    h.host.setBounds({ x: 24, y: 100, width: 700, height: 400 })
    expect(h.bounds).toHaveBeenLastCalledWith({ x: 24, y: 100, width: 700, height: 400 })
    h.host.close()
    expect(h.children).toHaveLength(0)
    expect(h.close).toHaveBeenCalledOnce()
  })

  it('blocks non HTTPS navigation and all popups inside the remote view', async () => {
    const h = harness()
    await h.host.show('https://smith.langchain.com/o/test/r/1', {
      x: 0,
      y: 0,
      width: 200,
      height: 200
    })
    const blocked = { preventDefault: vi.fn() }
    h.navigate()?.(blocked, 'file:///tmp/private')
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    const redirect = { preventDefault: vi.fn() }
    h.redirect()?.(redirect, 'http://evil.example')
    expect(redirect.preventDefault).toHaveBeenCalledOnce()
    expect(h.newWindow()?.({ url: 'https://evil.example' })).toEqual({ action: 'deny' })
  })

  it('removes the embedded view when LangSmith fails to load', async () => {
    const h = harness()
    h.loadURL.mockRejectedValueOnce(new Error('offline'))
    await expect(
      h.host.show('https://smith.langchain.com/r/1', { x: 0, y: 0, width: 200, height: 200 })
    ).rejects.toThrow('offline')
    expect(h.children).toHaveLength(0)
    expect(h.close).toHaveBeenCalledOnce()
  })
})
