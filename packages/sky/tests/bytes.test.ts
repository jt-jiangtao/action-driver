// @vitest-environment node
import { expect, test } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { originalModule } from '../../cua/tests/original-module'
import { fromFilePath, toBase64, toDataUrl } from '../src/core/bytes'
test('encoding preserves subarray offsets and empty arrays', async () => {
  const ref = await originalModule(
    resolve(
      'apps/agent-runtime/vendor/codex-cua/@oai/sky/dist/project/cua/sky_js/src/core/uint8.js'
    )
  )
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([1, 2, 3]),
    new Uint8Array([99, 1, 2, 88]).subarray(1, 3)
  ]) {
    expect(toBase64(bytes)).toBe(ref.to_base64!(bytes))
    expect(toDataUrl(bytes, 'image/png')).toBe(ref.to_data_url!(bytes, 'image/png'))
  }
})
test('file loading returns exact bytes and propagates missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cua-bytes-'))
  try {
    const p = join(root, 'bytes')
    await writeFile(p, new Uint8Array([0, 255, 1]))
    expect(await fromFilePath(p)).toEqual(new Uint8Array([0, 255, 1]))
    await expect(fromFilePath(p + 'missing')).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
