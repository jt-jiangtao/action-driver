export type WanderPoint = { x: number; y: number }

const CONTROL_POINTS: readonly WanderPoint[] = [
  { x: -0.66, y: -0.36 },
  { x: 0.08, y: -0.8 },
  { x: 0.82, y: -0.34 },
  { x: 0.51, y: 0.54 },
  { x: -0.19, y: 0.8 },
  { x: -0.84, y: 0.2 }
]
const SAMPLES_PER_SEGMENT = 16

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return (
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t * t * t)
  )
}

function seedOffset(seed: string, length: number): number {
  let hash = 2166136261
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0) % length
}

export function createWanderPath(
  width: number,
  height: number,
  cloudSize: number,
  seed: string
): WanderPoint[] {
  const sampleCount = CONTROL_POINTS.length * SAMPLES_PER_SEGMENT
  const start = seedOffset(seed, sampleCount)
  const radiusX = Math.max(0, (width - cloudSize) / 2 - 12)
  const radiusY = Math.max(0, (height - cloudSize) / 2 - 12)

  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const position = ((index + start) % sampleCount) / SAMPLES_PER_SEGMENT
    const segment = Math.floor(position)
    const t = position - segment
    const point = (offset: number) =>
      CONTROL_POINTS[(segment + offset + CONTROL_POINTS.length) % CONTROL_POINTS.length]!
    return {
      x: Math.max(
        -radiusX,
        Math.min(radiusX, catmullRom(point(-1).x, point(0).x, point(1).x, point(2).x, t) * radiusX)
      ),
      y: Math.max(
        -radiusY,
        Math.min(radiusY, catmullRom(point(-1).y, point(0).y, point(1).y, point(2).y, t) * radiusY)
      )
    }
  })
}
