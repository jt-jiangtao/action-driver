import { useLayoutEffect, type RefObject } from 'react'

const EDGE_MARGIN_PX = 1

/** Which edges of a scroll container are hiding content right now. */
export function scrollFadeEdges(metrics: {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientHeight: number
  clientWidth: number
}): string[] {
  const edges: string[] = []
  const canScrollY = metrics.scrollHeight - metrics.clientHeight > EDGE_MARGIN_PX
  const canScrollX = metrics.scrollWidth - metrics.clientWidth > EDGE_MARGIN_PX
  if (canScrollY && metrics.scrollTop > EDGE_MARGIN_PX) edges.push('top')
  if (
    canScrollY &&
    metrics.scrollTop + metrics.clientHeight < metrics.scrollHeight - EDGE_MARGIN_PX
  ) {
    edges.push('bottom')
  }
  if (canScrollX && metrics.scrollLeft > EDGE_MARGIN_PX) edges.push('left')
  if (
    canScrollX &&
    metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - EDGE_MARGIN_PX
  ) {
    edges.push('right')
  }
  return edges
}

function applyFade(element: HTMLElement): void {
  const edges = scrollFadeEdges(element)
  if (edges.length > 0) element.setAttribute('data-fade', edges.join(' '))
  else element.removeAttribute('data-fade')
}

/**
 * Marks a scroll container (or the scrollable descendants matching `selector`)
 * with `data-fade="top bottom left right"` so CSS can fade the cut-off edges
 * instead of slicing content with a hard line.
 */
export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  options: { selector?: string; deps?: readonly unknown[] } = {}
): void {
  const { selector, deps = [] } = options
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const targets = selector
      ? [root, ...Array.from(root.querySelectorAll<HTMLElement>(selector))]
      : [root]
    const cleanups = targets.map((target) => {
      if (selector) {
        target.style.overflowX = 'auto'
        target.style.overflowY = 'auto'
      }
      applyFade(target)
      const onScroll = () => applyFade(target)
      target.addEventListener('scroll', onScroll, { passive: true })
      return () => target.removeEventListener('scroll', onScroll)
    })

    const runAll = () => {
      for (const target of targets) applyFade(target)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(runAll)
    if (resizeObserver) {
      for (const target of targets) resizeObserver.observe(target)
      resizeObserver.observe(root)
    }
    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            for (const target of targets) applyFade(target)
          })
    mutationObserver?.observe(root, { childList: true, subtree: true, characterData: true })
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', runAll)
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', runAll)
      }
    }
  }, deps)
}
