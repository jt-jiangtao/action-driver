import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sharedPackages = ['agent-runtime', 'model-provider-runtime', 'model-connections'] as const

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

function forbiddenImports(source: string, file: string): string[] {
  return [...source.matchAll(/\b(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)]
    .map((match) => match[2]!)
    .filter((specifier) => {
      if (specifier === 'electron' || specifier === 'better-sqlite3') return true
      if (specifier.startsWith('apps/')) return true
      if (!specifier.startsWith('.')) return false
      const target = resolve(file, '..', specifier)
      return target.includes('/apps/')
    })
}

describe('shared runtime package boundaries', () => {
  it('rejects host imports, including relative imports into apps', () => {
    expect(forbiddenImports("import { x } from '../../../apps/local-runtime/src/x'", '/repo/packages/agent-runtime/src/a.ts'))
      .toEqual(["../../../apps/local-runtime/src/x"])
    expect(forbiddenImports("import Electron from 'electron'", '/repo/packages/agent-runtime/src/a.ts'))
      .toEqual(['electron'])
  })

  it.each(sharedPackages)('%s does not import local host implementations', (name) => {
    const root = resolve('packages', name)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      expect(['electron', 'better-sqlite3', '@action-driver/local-runtime']).not.toContain(name)
    }
    const violations = sourceFiles(join(root, 'src')).flatMap((file) =>
      forbiddenImports(readFileSync(file, 'utf8'), file).map((specifier) =>
        `${relative(root, file)}: ${specifier}`
      )
    )
    expect(violations).toEqual([])
  })

  it('keeps the shared packages acyclic', () => {
    const runtime = JSON.parse(readFileSync('packages/agent-runtime/package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    const provider = JSON.parse(readFileSync('packages/model-provider-runtime/package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    const contracts = JSON.parse(readFileSync('packages/model-connections/package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(runtime.dependencies).not.toHaveProperty('@action-driver/model-provider-runtime')
    expect(provider.dependencies).not.toHaveProperty('@action-driver/agent-runtime')
    expect(contracts.dependencies).not.toHaveProperty('@action-driver/agent-runtime')
    expect(contracts.dependencies).not.toHaveProperty('@action-driver/model-provider-runtime')
  })
})
