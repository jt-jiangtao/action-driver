import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('model provider package boundary', () => {
  it('keeps provider SDK and model service implementation out of the shared package', () => {
    const shared = JSON.parse(readFileSync('packages/model-connections/package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    const exports = readFileSync('packages/model-connections/src/index.ts', 'utf8')
    expect(shared.dependencies).not.toHaveProperty('openai')
    expect(exports).not.toContain("./provider-adapters")
    expect(exports).not.toContain("./service")
  })
})
