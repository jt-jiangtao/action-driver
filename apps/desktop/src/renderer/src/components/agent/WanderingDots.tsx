import { useEffect, useRef } from 'react'
import { createWanderPath } from './wanderingDotsPath'

const CLOUD_SIZE = 84

export function WanderingDots({ seed }: { seed: string }) {
  const cloudRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const cloud = cloudRef.current
    const card = cloud?.parentElement
    if (!cloud || !card) return

    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let size = card.getBoundingClientRect()
    let animation: Animation | undefined

    const updateAnimation = () => {
      animation?.cancel()
      animation = undefined
      if (motionPreference?.matches || !cloud.animate) return
      const frames = createWanderPath(size.width, size.height, CLOUD_SIZE, seed).map(
        ({ x, y }) => ({ transform: `translate3d(${x}px, ${y}px, 0)` })
      )
      const phase = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0)
      animation = cloud.animate(frames, {
        duration: 10_000 + (phase % 5) * 400,
        iterations: Infinity,
        easing: 'linear'
      })
    }

    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(([entry]) => {
            if (!entry) return
            size = entry.contentRect
            updateAnimation()
          })
    observer?.observe(card)
    motionPreference?.addEventListener('change', updateAnimation)
    updateAnimation()

    return () => {
      animation?.cancel()
      observer?.disconnect()
      motionPreference?.removeEventListener('change', updateAnimation)
    }
  }, [seed])

  return <span className="image-gallery-dots" aria-hidden="true" ref={cloudRef} />
}
