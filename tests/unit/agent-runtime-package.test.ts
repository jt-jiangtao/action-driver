import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runtimeRoot = resolve(process.cwd(), 'packages/agent-runtime')
const localRuntimeRoot = resolve(process.cwd(), 'apps/local-runtime')

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
      name: '@action-driver/agent-runtime',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' }
    })
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        typecheck: 'tsc --noEmit -p tsconfig.json'
      })
    )
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        '@langchain/core': expect.stringMatching(/^\d/),
        '@langchain/langgraph': expect.stringMatching(/^\d/),
        zod: expect.stringMatching(/^\d/)
      })
    )
    expect(packageJson.dependencies).not.toHaveProperty('inversify')
    expect(packageJson.dependencies).not.toHaveProperty('reflect-metadata')
    for (const version of Object.values(packageJson.dependencies)) {
      if (version.startsWith('workspace:')) continue
      expect(version).not.toMatch(/^[~^*]/)
    }
  })

  it('keeps the local process as a separate app', async () => {
    const localPackage = JSON.parse(
      await readFile(resolve(localRuntimeRoot, 'package.json'), 'utf8')
    ) as { name: string; main: string; dependencies: Record<string, string> }
    expect(localPackage.name).toBe('@action-driver/local-runtime')
    expect(localPackage.main).toBe('dist/index.js')
    expect(localPackage.dependencies['@action-driver/agent-runtime']).toBe('workspace:*')
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
