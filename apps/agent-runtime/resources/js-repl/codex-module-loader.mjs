// The Codex runtime loads its bundled JS as ESM, including packages nested below node_modules.
// Keep vendor bytes unchanged; adapt module format only within the canonical vendor directory.
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const configuredRoot = process.env.CUA_VENDOR_ROOT
if (!configuredRoot) throw new Error('CUA_VENDOR_ROOT is required for the Codex module adapter')
const root = await realpath(resolve(configuredRoot))

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.js')) {
    const path = await realpath(fileURLToPath(url))
    if (path.startsWith(root + sep)) {
      return { format: 'module', source: await readFile(path, 'utf8'), shortCircuit: true }
    }
  }
  return await nextLoad(url, context)
}
