import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(path)
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : []
      })
    )
  ).flat()
}

describe('renderer dependency boundary', () => {
  it('keeps infrastructure adapters outside pages and components', async () => {
    const sourceRoot = join(import.meta.dirname, '../../../../../src/renderer/src')
    const files = [
      ...(await sourceFiles(join(sourceRoot, 'components'))),
      ...(await sourceFiles(join(sourceRoot, 'pages')))
    ]

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source).not.toMatch(/from ['"]inversify['"]/)
      expect(source).not.toMatch(/services\/(?:[^/'"]+\/)*(?:mock|desktop)-/)
      expect(source).not.toMatch(/new Container\(/)
    }
  })

  it('limits the public Runtime stream contract to the Renderer stream adapters', async () => {
    const rendererRoot = join(import.meta.dirname, '../../../../../src/renderer/src')
    const files = await sourceFiles(rendererRoot)

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (
        file.endsWith('services/agent-session/renderer-stream-client.ts') ||
        file.endsWith('services/agent-session/stream-task-projection.ts')
      ) {
        expect(source).toMatch(/@action-driver\/runtime-contracts/)
      } else {
        expect(source).not.toMatch(/@action-driver\/runtime-contracts/)
      }
      expect(source).not.toMatch(/runtime-message-port|parent-port-endpoint|MessagePortMain/)
      expect(source).not.toMatch(/action-driver\.db|databasePath|runtimeEntryPath/)
    }
  })
})
