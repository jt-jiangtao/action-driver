import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop development runtime', () => {
  it('builds the Agent Runtime from the root development command before Electron starts', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts.dev).toBe(
      'node scripts/dev.mjs'
    )
  })

  it('rebuilds the Agent Runtime before starting Electron development mode', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts.predev).toBe(
      'corepack pnpm --filter @action-driver/local-runtime build' +
      ' && corepack pnpm --dir ../.. build:native:computer-use'
    )
  })
})
