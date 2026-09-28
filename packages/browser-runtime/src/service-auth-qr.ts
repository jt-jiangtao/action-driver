export interface QrPoint { x: number; y: number }
export interface AuthQrCode {
  payload: string
  bounds: { x: number; y: number; width: number; height: number }
}
/** Preserve the broker's QR payload only when the detected polygon is usable. */
export function normalizeAuthQrCode(payload: string, points: readonly QrPoint[]): AuthQrCode | null {
  if (payload.length === 0 || points.length < 4 ||
    points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) return null
  const x = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))))
  const y = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))))
  const width = Math.ceil(Math.max(...points.map((point) => point.x))) - x
  const height = Math.ceil(Math.max(...points.map((point) => point.y))) - y
  if (![x, y, width, height].every(Number.isSafeInteger) || width <= 0 || height <= 0)
    return null
  return { payload, bounds: { x, y, width, height } }
}
/** Only a credential-free HTTPS URL may be exposed outside the secure QR broker. */
export function safeQrSignInUrl(payload: string): string | undefined {
  if (!URL.canParse(payload)) return undefined
  const url = new URL(payload)
  return url.protocol === 'https:' && url.hostname.length > 0 &&
    url.username.length === 0 && url.password.length === 0
    ? payload
    : undefined
}
