import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop development runtime', () => {
  it('rebuilds the Agent Runtime before starting Electron development mode', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')
    ) as { scripts: Record<string, string> }

    expect(packageJson.scripts.predev).toBe(
      'corepack pnpm --filter @actiondriver/agent-runtime build'
    )
  })
})
