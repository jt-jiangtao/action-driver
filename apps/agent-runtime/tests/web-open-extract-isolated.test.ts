import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractPageTextIsolated } from '../src/web-open/extract-isolated'

describe('isolated webpage extraction', () => {
  let directory: string
  let workerUrl: URL

  beforeAll(async () => {
    const dist = join(process.cwd(), 'apps/agent-runtime/dist')
    await mkdir(dist, { recursive: true })
    directory = await mkdtemp(join(dist, '.web-open-test-'))
    const workerPath = join(directory, 'worker.mjs')
    await promisify(execFile)(
      'pnpm',
      [
        'exec',
        'esbuild',
        'src/web-open/extract-worker.ts',
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--external:jsdom',
        '--external:@mozilla/readability',
        '--banner:js=import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
        `--outfile=${workerPath}`
      ],
      { cwd: join(process.cwd(), 'apps/agent-runtime') }
    )
    workerUrl = pathToFileURL(workerPath)
  }, 20_000)

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('extracts a normal page in its worker', async () => {
    const result = await extractPageTextIsolated(
      '<html><body><main>Worker page</main></body></html>',
      'https://example.com/page',
      { workerUrl, timeoutMs: 5_000 }
    )
    expect(result.text).toBe('Worker page')
  })

  it('keeps the Runtime event loop responsive and terminates costly parsing', async () => {
    const html = '<div>'.repeat(18_000) + 'visible' + '</div>'.repeat(18_000)
    let heartbeat = false
    const tick = setTimeout(() => {
      heartbeat = true
    }, 20)
    try {
      await expect(
        extractPageTextIsolated(html, 'https://example.com/deep', { workerUrl, timeoutMs: 150 })
      ).rejects.toThrow('WEB_OPEN_PARSE_TIMEOUT')
      expect(heartbeat).toBe(true)
    } finally {
      clearTimeout(tick)
    }
  })

  it('terminates parsing on user cancellation', async () => {
    const controller = new AbortController()
    const pending = extractPageTextIsolated(
      '<div>'.repeat(18_000) + '</div>'.repeat(18_000),
      'https://example.com/deep',
      { workerUrl, signal: controller.signal }
    )
    controller.abort(new Error('USER_CANCELLED'))
    await expect(pending).rejects.toThrow('USER_CANCELLED')
  })
})
