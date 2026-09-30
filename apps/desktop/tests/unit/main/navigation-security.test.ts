import { describe, expect, it, vi } from 'vitest'
import { installNavigationGuards, resolveTrustedRendererOrigin } from '../../../src/main/navigation-security'

describe('installNavigationGuards', () => {
  it('derives a stable exact origin for the packaged application protocol', () => {
    expect(resolveTrustedRendererOrigin('action-driver://renderer/index.html'))
      .toBe('action-driver://renderer')
  })

  it('denies new windows and prevents navigation outside the renderer origin', () => {
    let openHandler: ((details: { url: string }) => { action: 'deny' | 'allow' }) | undefined
    let navigateHandler: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const target = {
      setWindowOpenHandler(handler: typeof openHandler) {
        openHandler = handler
      },
      on(
        event: 'will-navigate',
        handler: (event: { preventDefault(): void }, url: string) => void
      ) {
        expect(event).toBe('will-navigate')
        navigateHandler = handler
      }
    }

    installNavigationGuards(target, 'http://localhost:5173/')

    expect(openHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    const sameOriginEvent = { preventDefault: vi.fn() }
    navigateHandler?.(sameOriginEvent, 'http://localhost:5173/tasks/hotel-task')
    expect(sameOriginEvent.preventDefault).not.toHaveBeenCalled()
    const externalEvent = { preventDefault: vi.fn() }
    navigateHandler?.(externalEvent, 'https://example.com')
    expect(externalEvent.preventDefault).toHaveBeenCalledOnce()
  })

  it('allows only the exact packaged renderer file', () => {
    let navigateHandler: ((event: { preventDefault(): void }, url: string) => void) | undefined
    const target = {
      setWindowOpenHandler() {},
      on(
        _event: 'will-navigate',
        handler: (event: { preventDefault(): void }, url: string) => void
      ) {
        navigateHandler = handler
      }
    }
    const entry =
      'file:///Applications/Action-Driver.app/Contents/Resources/app.asar/out/renderer/index.html'
    installNavigationGuards(target, entry)

    const entryEvent = { preventDefault: vi.fn() }
    navigateHandler?.(entryEvent, entry)
    expect(entryEvent.preventDefault).not.toHaveBeenCalled()
    const siblingEvent = { preventDefault: vi.fn() }
    navigateHandler?.(
      siblingEvent,
      'file:///Applications/Action-Driver.app/Contents/Resources/app.asar/package.json'
    )
    expect(siblingEvent.preventDefault).toHaveBeenCalledOnce()
  })
})
