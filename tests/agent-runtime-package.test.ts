import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runtimeRoot = resolve(process.cwd(), 'apps/agent-runtime')

describe('agent runtime package', () => {
  it('declares a standalone build with pinned runtime dependencies', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(runtimeRoot, 'package.json'), 'utf8')
    ) as {
      name: string
      private: boolean
      type: string
      main: string
      scripts: Record<string, string>
      dependencies: Record<string, string>
    }

    expect(packageJson).toMatchObject({
      name: '@actiondriver/agent-runtime',
      private: true,
      type: 'module',
      main: 'dist/index.js'
    })
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        build: expect.stringContaining('src/index.ts'),
        typecheck: 'tsc --noEmit -p tsconfig.json'
      })
    )
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        '@langchain/core': expect.stringMatching(/^\d/),
        '@langchain/langgraph': expect.stringMatching(/^\d/),
        '@langchain/langgraph-checkpoint-sqlite': expect.stringMatching(/^\d/),
        'better-sqlite3': expect.stringMatching(/^\d/),
        inversify: expect.stringMatching(/^\d/),
        zod: expect.stringMatching(/^\d/)
      })
    )
    for (const version of Object.values(packageJson.dependencies)) {
      if (version.startsWith('workspace:')) continue
      expect(version).not.toMatch(/^[~^*]/)
    }
  })

  it('exposes a TypeScript entrypoint and project configuration', async () => {
    await expect(access(resolve(runtimeRoot, 'src/index.ts'))).resolves.toBeUndefined()
    const tsconfig = JSON.parse(await readFile(resolve(runtimeRoot, 'tsconfig.json'), 'utf8')) as {
      extends: string
      include: string[]
    }
    expect(tsconfig.extends).toBe('../../tsconfig.base.json')
    expect(tsconfig.include).toContain('src')
  })
})
