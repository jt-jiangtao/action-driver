import type { DetailBounds } from '../shared/detail-bounds'

type DetailContents = {
  loadURL(url: string): Promise<unknown>
  close(): void
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(
    event: 'will-navigate' | 'will-redirect',
    handler: (event: { preventDefault(): void }, url: string) => void
  ): void
}

export type DetailView = {
  setBounds(bounds: DetailBounds): void
  webContents: DetailContents
}

type DetailWindow = {
  contentView: {
    addChildView(view: DetailView): void
    removeChildView(view: DetailView): void
  }
}

export function createLangSmithDetailHost(window: DetailWindow, createView: () => DetailView) {
  let current: DetailView | null = null

  function close(): void {
    if (!current) return
    window.contentView.removeChildView(current)
    current.webContents.close()
    current = null
  }

  return {
    async show(url: string, bounds: DetailBounds): Promise<void> {
      close()
      const view = createView()
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guardNavigation = (event: { preventDefault(): void }, target: string) => {
        try {
          if (new URL(target).protocol !== 'https:') event.preventDefault()
        } catch {
          event.preventDefault()
        }
      }
      view.webContents.on('will-navigate', guardNavigation)
      view.webContents.on('will-redirect', guardNavigation)
      view.setBounds(bounds)
      window.contentView.addChildView(view)
      current = view
      try {
        await view.webContents.loadURL(url)
      } catch (error) {
        if (current === view) close()
        throw error
      }
    },
    setBounds(bounds: DetailBounds): void {
      current?.setBounds(bounds)
    },
    close
  }
}
