import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WanderingDots } from './WanderingDots'

class TestResizeObserver {
  static current: TestResizeObserver | undefined
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.current = this
  }
  emit(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
}

function browserMotion(reduced = false) {
  const cancel = vi.fn()
  const animate = vi.fn((...args: Parameters<HTMLElement['animate']>) => {
    void args
    return { cancel } as unknown as Animation
  })
  let listener: ((event: MediaQueryListEvent) => void) | undefined
  let matches = reduced
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches
      },
      addEventListener: (_name: string, callback: (event: MediaQueryListEvent) => void) => {
        listener = callback
      },
      removeEventListener: () => {
        listener = undefined
      }
    }))
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 282,
    height: 282
  } as DOMRect)
  vi.stubGlobal('Element', Element)
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  return {
    animate,
    cancel,
    change(value: boolean) {
      matches = value
      act(() => listener?.({ matches: value } as MediaQueryListEvent))
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { animate?: unknown }).animate
  TestResizeObserver.current = undefined
})

describe('WanderingDots', () => {
  it('moves one cloud on a curved path and restarts within bounds after resize', () => {
    const motion = browserMotion()
    const view = render(
      <div>
        <WanderingDots seed="call-a:0" />
      </div>
    )
    expect(view.container.querySelectorAll('.image-gallery-dots')).toHaveLength(1)
    expect(motion.animate).toHaveBeenCalledTimes(1)
    const [frames, options] = motion.animate.mock.calls[0]!
    expect(frames).toHaveLength(97)
    expect(options).toMatchObject({ iterations: Infinity })
    expect((options as KeyframeAnimationOptions).duration).toBeGreaterThanOrEqual(10_000)
    expect((options as KeyframeAnimationOptions).duration).toBeLessThanOrEqual(12_000)
    expect((frames as Keyframe[])[0]?.transform).toBe((frames as Keyframe[]).at(-1)?.transform)

    act(() => TestResizeObserver.current?.emit(480, 480))
    expect(motion.cancel).toHaveBeenCalledTimes(1)
    expect(motion.animate).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(motion.cancel).toHaveBeenCalledTimes(2)
    expect(TestResizeObserver.current?.disconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps a static cloud for reduced motion and reacts to preference changes', () => {
    const motion = browserMotion(true)
    const view = render(
      <div>
        <WanderingDots seed="call-a:1" />
      </div>
    )
    expect(view.container.querySelector('.image-gallery-dots')).toBeInTheDocument()
    expect(motion.animate).not.toHaveBeenCalled()
    motion.change(false)
    expect(motion.animate).toHaveBeenCalledTimes(1)
    motion.change(true)
    expect(motion.cancel).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
