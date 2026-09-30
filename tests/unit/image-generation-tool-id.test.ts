import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IMAGE_GENERATION_TOOL_ID } from '@action-driver/contracts'

const root = process.cwd()
const literal = 'tools/local/image-generation/generate'

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory)
  const files: string[] = []
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) files.push(path)
  }
  return files
}

describe('image generation tool id boundary', () => {
  it('is declared once in the plugin manifest and matches the shared contract', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'plugins/image-generation/plugin.json'), 'utf8')
    ) as { activation?: string[]; contributions?: Array<{ id?: string }> }
    const declared = manifest.contributions?.map((tool) => tool.id) ?? []
    expect(declared).toContain(IMAGE_GENERATION_TOOL_ID)
    expect(manifest.activation ?? []).toContain(`onTool:${IMAGE_GENERATION_TOOL_ID}`)
  })

  it('is never hardcoded by renderer or runtime consumers', () => {
    const consumers = [
      ...sourceFiles(join(root, 'apps/desktop/src/renderer/src')),
      ...sourceFiles(join(root, 'apps/desktop/src/preload')),
      ...sourceFiles(join(root, 'apps/desktop/src/shared')),
      ...sourceFiles(join(root, 'apps/local-runtime/src'))
    ]
    const offenders = consumers.filter((file) => readFileSync(file, 'utf8').includes(literal))
    expect(offenders).toEqual([])
  })
})
