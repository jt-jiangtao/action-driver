import { describe, expect, it } from 'vitest'
import { createWanderPath } from './wanderingDotsPath'

describe('createWanderPath', () => {
  it.each([128, 282, 480])('keeps a small dot cloud inside a %ipx square', (size) => {
    const cloudSize = 84
    const path = createWanderPath(size, size, cloudSize, 'call-a:0')
    const safeCenter = (size - cloudSize) / 2 - 12
    expect(path.length).toBeGreaterThan(60)
    expect(path[0]).toEqual(path.at(-1))
    for (const point of path) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(safeCenter + 0.01)
      expect(Math.abs(point.y)).toBeLessThanOrEqual(safeCenter + 0.01)
    }
  })

  it('takes a curved route around the card rather than a single axis', () => {
    const path = createWanderPath(282, 282, 84, 'call-a:0')
    const xs = path.map((point) => point.x)
    const ys = path.map((point) => point.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(100)
    const steps = path
      .slice(1)
      .map((point, index) => Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y))
    expect(Math.max(...steps)).toBeLessThan(15)
  })

  it('starts different slots at different positions while remaining deterministic', () => {
    const first = createWanderPath(282, 282, 84, 'call-a:0')
    const second = createWanderPath(282, 282, 84, 'call-a:1')
    expect(first[0]).not.toEqual(second[0])
    expect(createWanderPath(282, 282, 84, 'call-a:0')).toEqual(first)
  })
})
