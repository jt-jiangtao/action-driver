// @vitest-environment node
import { expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const checker = async () =>
  (await import('../../../../analysis/codex-cua/verify-browser-resource-provenance.mjs'))
    .verifyBrowserResourceProvenance as (
      root: string, records: Array<{ sourcePath: string; sourceSha256: string; output: string; outputSha256: string }>
    ) => Promise<void>

test('browser resource provenance rejects source and extracted-data drift', async () => {
  const verify = await checker()
  const root = await mkdtemp(join(tmpdir(), 'browser-resource-provenance-'))
  const fixture = {
    sourcePath: 'vendor/service.mjs',
    sourceSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    output: 'resources/data.json',
    outputSha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
  }
  try {
    for (const path of [fixture.sourcePath, fixture.output]) await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, fixture.sourcePath), 'hello')
    await writeFile(join(root, fixture.output), '{}')
    await expect(verify(root, [fixture])).resolves.toBeUndefined()
    await writeFile(join(root, fixture.sourcePath), 'changed')
    await expect(verify(root, [fixture])).rejects.toThrow('vendor/service.mjs')
    await writeFile(join(root, fixture.sourcePath), 'hello')
    await writeFile(join(root, fixture.output), '{"changed":true}')
    await expect(verify(root, [fixture])).rejects.toThrow('resources/data.json')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('both committed browser resource records still match the vendor and candidate files', async () => {
  const verify = await checker()
  const records = await Promise.all([
    'browser-resource-provenance.json', 'browser-keyboard-provenance.json'
  ].map(async (name) => JSON.parse(await readFile(resolve('analysis/codex-cua', name), 'utf8'))))
  await expect(verify(resolve('.'), records)).resolves.toBeUndefined()
})
