/** Check fixed extraction evidence without rewriting the original or candidate resource. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const digest = (data) => createHash('sha256').update(data).digest('hex')

export async function verifyBrowserResourceProvenance(root, records) {
  for (const record of records) {
    for (const [path, expected] of [
      [record.sourcePath, record.sourceSha256],
      [record.output, record.outputSha256]
    ]) {
      const actual = digest(await readFile(resolve(root, path)))
      if (actual !== expected)
        throw Error(`Browser resource provenance drift: ${path}: expected ${expected}, got ${actual}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '../..')
  const records = await Promise.all([
    'browser-resource-provenance.json',
    'browser-keyboard-provenance.json'
  ].map(async (name) => JSON.parse(await readFile(resolve(import.meta.dirname, name), 'utf8'))))
  await verifyBrowserResourceProvenance(root, records)
  process.stdout.write(`Browser resource provenance verified: ${records.length} records\n`)
}
