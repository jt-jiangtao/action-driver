import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('runtime architecture guards', () => {
  it('keeps database drivers out of Electron Main and Renderer sources', () => {
    const desktopSource = resolve(process.cwd(), 'apps/desktop/src')
    const sourceFiles = readdirSync(desktopSource, { recursive: true })
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
      .filter((entry) => /\.[cm]?[jt]sx?$/.test(entry))
      .map((entry) => readFileSync(join(desktopSource, entry), 'utf8'))

    expect(sourceFiles.join('\n')).not.toMatch(
      /from ['"]better-sqlite3['"]|require\(['"]better-sqlite3['"]\)/
    )
  })
})
