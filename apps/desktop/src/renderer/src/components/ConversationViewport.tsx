import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useScrollFade } from './scroll-fade'

const FOLLOW_THRESHOLD_PX = 24

export function ConversationViewport({
  followKey,
  children
}: {
  followKey: string | number
  children: ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const followsLatestRef = useRef(true)
  useScrollFade(viewportRef, { deps: [followKey] })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !followsLatestRef.current || typeof viewport.scrollTo !== 'function') return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' })
  }, [followKey])

  return (
    <div
      ref={viewportRef}
      className="conversation-scroll"
      onScroll={(event) => {
        const viewport = event.currentTarget
        const distanceFromBottom =
          viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
        followsLatestRef.current = distanceFromBottom <= FOLLOW_THRESHOLD_PX
      }}
    >
      {children}
    </div>
  )
}
