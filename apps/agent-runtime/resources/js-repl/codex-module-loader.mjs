// The Codex runtime loads its bundled JS as ESM, including packages nested below node_modules.
// Keep vendor bytes unchanged; adapt module format only within the canonical vendor directory.
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const configuredRoot = process.env.CUA_VENDOR_ROOT
if (!configuredRoot) throw new Error('CUA_VENDOR_ROOT is required for the Codex module adapter')
const root = await realpath(resolve(configuredRoot))

// The vendored telemetry module imports `@statsig/js-client`, which is not resolvable from the
// vendor tree. The trusted host already replaces this module with a synthetic one
// (`codex-service-host.mjs`); mirror that here, so a model that imports `@oai/sky` directly still
// runs instead of failing on the missing package.
const telemetryPath = resolve(
  root,
  '@oai/sky/dist/project/cua/sky_js/src/targets/mac/computer-use-telemetry.js'
)
const telemetryStub = [
  'export const logComputerUseClientCreated = () => {}',
  'export const logComputerUseApprovalRequested = () => {}',
  'export const logComputerUseApprovalResolved = () => {}',
  'export const logComputerUseToolCalled = () => {}'
].join('\n')

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.js')) {
    const path = await realpath(fileURLToPath(url))
    if (path.startsWith(root + sep)) {
      if (path === telemetryPath) return { format: 'module', source: telemetryStub, shortCircuit: true }
      return { format: 'module', source: await readFile(path, 'utf8'), shortCircuit: true }
    }
  }
  return await nextLoad(url, context)
}
