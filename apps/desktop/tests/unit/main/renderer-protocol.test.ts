import { describe, expect, it } from 'vitest'
import { resolveRendererAssetPath } from '../../../src/main/renderer-protocol'

describe('packaged renderer assets', () => {
  it('resolves bundled assets and rejects other hosts and path escapes', () => {
    expect(resolveRendererAssetPath('/app/out/renderer', 'actiondriver://renderer/index.html'))
      .toBe('/app/out/renderer/index.html')
    expect(resolveRendererAssetPath('/app/out/renderer', 'actiondriver://other/index.html'))
      .toBeNull()
    expect(resolveRendererAssetPath('/app/out/renderer', 'actiondriver://renderer/%2e%2e%2fsecret'))
      .toBeNull()
  })
})
