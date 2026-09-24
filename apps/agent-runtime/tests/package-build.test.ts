import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('agent runtime build', () => {
  it('keeps the CommonJS ws package external to the ESM runtime bundle', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')
    ) as { scripts: { build: string } }

    expect(packageJson.scripts.build).toContain('--external:ws')
    expect(packageJson.scripts.build).toContain('__actionDriverCreateRequire(import.meta.url)')
    expect(packageJson.scripts.build).toContain('scripts/stage-runtimes.mjs')
    expect(packageJson.scripts.build).toContain('scripts/copy-rg.mjs')
  })
})
