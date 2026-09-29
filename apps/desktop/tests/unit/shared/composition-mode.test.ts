import { describe, expect, it } from 'vitest'
import { resolveDesktopCompositionMode } from '../../../src/shared/composition-mode'

describe('desktop composition mode', () => {
  it.each([
    ['production', 'local'],
    ['development', 'local'],
    ['visual', 'mock'],
    ['test', 'mock']
  ] as const)('maps the %s build to %s services', (buildMode, expected) => {
    expect(resolveDesktopCompositionMode(buildMode)).toBe(expected)
  })
})
