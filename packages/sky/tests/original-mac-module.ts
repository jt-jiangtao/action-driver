import { readFile } from 'node:fs/promises'
import { dirname, resolve, basename } from 'node:path'
const root = resolve(
  'apps/agent-runtime/vendor/codex-cua/@oai/sky/dist/project/cua/sky_js/src/targets/mac'
)
// Test-only replacements at dependency boundaries; the baseline module body is unchanged.
async function moduleUrl(path: string): Promise<string> {
  let source = await readFile(path, 'utf8')
  if (basename(path) === 'lazy-client.js')
    source = "export const getClient=async()=>globalThis[Symbol.for('cua-reference-client')];"
  if (basename(path) === 'computer-use-telemetry.js')
    source =
      "const sink=()=>globalThis[Symbol.for('cua-reference-telemetry')];export const logComputerUseToolCalled=e=>sink().toolCalled(e);export const logComputerUseApprovalRequested=e=>sink().approvalRequested(e);export const logComputerUseApprovalResolved=e=>sink().approvalResolved(e);export const logComputerUseClientCreated=()=>sink().clientCreated();"
  if (path === resolve(root, '../../create_client.js'))
    source = "export const create_client=()=>globalThis[Symbol.for('cua-reference-computer')];"
  if (path === resolve(root, '../../load_options.js'))
    source = "export const load_options=()=>({target:'mac'});"
  if (path === resolve(root, '../linux/accessibility_tree.js'))
    source = "export const accessibility_tree=()=>{throw new Error('Linux deferred')};"
  for (const match of [...source.matchAll(/import\s*["'](\.[^"']+)["']/g)])
    source = source.replace(
      match[0],
      `import ${JSON.stringify(await moduleUrl(resolve(dirname(path), match[1]!)))}`
    )
  for (const match of [...source.matchAll(/from\s*["'](\.[^"']+)["']/g)])
    source = source.replace(
      match[0],
      `from ${JSON.stringify(await moduleUrl(resolve(dirname(path), match[1]!)))}`
    )
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
}
export async function originalMacModule(name: string) {
  return import((await moduleUrl(resolve(root, name))) + '#' + Math.random())
}
