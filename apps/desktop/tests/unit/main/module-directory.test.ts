import { describe, expect, it } from 'vitest'
import { resolveModuleDirectory } from '../../../src/main/module-directory'

describe('resolveModuleDirectory', () => {
  it('resolves an ESM module URL without relying on CommonJS __dirname', () => {
    expect(resolveModuleDirectory('file:///tmp/action-driver/out/main/index.js')).toBe(
      '/tmp/action-driver/out/main'
    )
  })
})
