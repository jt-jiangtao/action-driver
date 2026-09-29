import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRef } from 'react'
import { useScrollFade } from '../../../../../src/renderer/src/components/scroll-fade'

function Scroller({
  scrollTop,
  scrollHeight,
  clientHeight
}: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollFade(ref)
  return (
    <div
      ref={(element) => {
        ref.current = element
        if (!element) return
        Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
        Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true })
        Object.defineProperty(element, 'scrollTop', {
          value: scrollTop,
          writable: true,
          configurable: true
        })
      }}
    />
  )
}

describe('scroll fade attributes', () => {
  it('marks only the edges that hide content', () => {
    const { container, rerender } = render(
      <Scroller scrollTop={0} scrollHeight={1000} clientHeight={400} />
    )
    const element = container.firstElementChild as HTMLElement
    expect(element.getAttribute('data-fade')).toBe('bottom')

    rerender(<Scroller scrollTop={600} scrollHeight={1000} clientHeight={400} />)
    element.dispatchEvent(new Event('scroll'))
    expect(element.getAttribute('data-fade')).toBe('top')
  })

  it('leaves content unfaded when it fits', () => {
    const { container } = render(<Scroller scrollTop={0} scrollHeight={400} clientHeight={400} />)
    expect((container.firstElementChild as HTMLElement).hasAttribute('data-fade')).toBe(false)
  })
})
