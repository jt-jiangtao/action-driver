// @vitest-environment node
import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readDesktopResource, listDesktopResources } from '../../src/resources'

test('cloud and orbit auth safety resources match preserved originals', async () => {
  for (const environment of ['cloud', 'orbit'] as const) {
    const text = await readDesktopResource(environment, 'browserAuthSafetyPrecheck.md')
    expect(text.length).toBeGreaterThan(0)
    const original = await readFile(resolve(
      `packages/back/browser-desktop/@oai/browser-desktop/environment-docs/${environment}/browserAuthSafetyPrecheck.md`
    ))
    expect(createHash('sha256').update(text).digest('hex'))
      .toBe(createHash('sha256').update(original).digest('hex'))
    expect((await listDesktopResources(environment)).length).toBeGreaterThan(20)
  }
  await expect(readDesktopResource('codex-app', 'browserAuthSafetyPrecheck.md'))
    .rejects.toThrow('BROWSER_AUTH_SAFETY_PRECHECK_UNAVAILABLE')
  await expect(readDesktopResource('cloud', '../package.json'))
    .rejects.toThrow('BROWSER_RESOURCE_PATH_INVALID')
})
