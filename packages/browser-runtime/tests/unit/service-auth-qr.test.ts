// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import { normalizeAuthQrCode, safeQrSignInUrl } from '../../src/service-auth-qr'

test('QR payload needs four finite points and a positive safe pixel rectangle', async () => {
  const original = await originalDocumentation()
  const cases = [
    ['https://example.com/signin', [{ x: 1.2, y: 2.4 }, { x: 9.1, y: 2 }, { x: 9.1, y: 8.9 }, { x: 1.2, y: 8.9 }]],
    ['', [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]],
    ['x', [{ x: 1, y: 1 }]],
    ['x', [{ x: NaN, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }]]
  ] as const
  for (const [payload, points] of cases)
    expect(normalizeAuthQrCode(payload, points)).toEqual(original.baselineAuthQrCode(payload, points))
})

test('only HTTPS QR URLs without embedded credentials may be shown as sign-in links', () => {
  expect(safeQrSignInUrl('https://example.com/signin')).toBe('https://example.com/signin')
  for (const value of ['http://example.com', 'https://user:pass@example.com', 'javascript:alert(1)', 'not a URL'])
    expect(safeQrSignInUrl(value)).toBeUndefined()
})
