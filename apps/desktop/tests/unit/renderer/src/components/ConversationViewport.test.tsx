import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationViewport } from '../../../../../src/renderer/src/components/ConversationViewport'

function setMetrics(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollTop: { configurable: true, writable: true, value: metrics.scrollTop }
  })
}

describe('ConversationViewport', () => {
  it('follows appended content only while the reader is near the bottom', () => {
    const { container, rerender } = render(
      <ConversationViewport followKey="first">first</ConversationViewport>
    )
    const viewport = container.querySelector('.conversation-scroll') as HTMLElement & {
      scrollTo: ReturnType<typeof vi.fn>
    }
    viewport.scrollTo = vi.fn()
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 400, scrollTop: 590 })
    fireEvent.scroll(viewport)

    rerender(<ConversationViewport followKey="second">second</ConversationViewport>)
    expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'auto' })

    viewport.scrollTo.mockClear()
    viewport.scrollTop = 300
    fireEvent.scroll(viewport)
    rerender(<ConversationViewport followKey="third">third</ConversationViewport>)
    expect(viewport.scrollTo).not.toHaveBeenCalled()

    viewport.scrollTop = 600
    fireEvent.scroll(viewport)
    rerender(<ConversationViewport followKey="fourth">fourth</ConversationViewport>)
    expect(viewport.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'auto' })
  })
})
