import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const sourceRoot = resolve(
  'packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/create_tinysky_alt.js'
)
async function moduleUrl(path: string): Promise<string> {
  let source = await readFile(path, 'utf8')
  if (path === sourceRoot) source += '\nexport {f as baselineDecorateTab};'
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path).href))
  source = source.replace(
    /import\(["']\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/project\/cua\/sky_js\/src\/index\.js["']\)/g,
    "Promise.resolve({sky:globalThis[Symbol.for('cua-test-reference-computer')]})"
  )
  source = source.replace(
    /import\(["']\.\.\/\.\.\/\.\.\/oai_js_browser\/dist\/skill\/scripts\/browser-client\.js["']\)/g,
    "Promise.resolve({setupBrowserRuntime:globalThis[Symbol.for('cua-test-reference-browser-setup')]})"
  )
  for (const match of [...source.matchAll(/from\s*["'](\.[^"']+)["']/g)])
    source = source.replace(
      match[0],
      `from ${JSON.stringify(await moduleUrl(resolve(dirname(path), match[1]!)))}`
    )
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
}
export async function originalComputerSession(computer: unknown, host: unknown) {
  Reflect.set(globalThis, Symbol.for('cua-test-reference-computer'), computer)
  Reflect.set(globalThis, 'nodeRepl', host)
  const original = await import(await moduleUrl(sourceRoot))
  return original.create_tinysky_alt({ browser: false, computer: true })
}

export async function originalTabDecorator() {
  return (await import(await moduleUrl(sourceRoot))).baselineDecorateTab
}

export async function originalBrowserSession(agent: unknown, host: unknown) {
  Reflect.set(globalThis, Symbol.for('cua-test-reference-browser-setup'), async () => agent)
  Reflect.set(globalThis, 'nodeRepl', host)
  const original = await import(await moduleUrl(sourceRoot))
  return original.create_tinysky_alt({ browser: true, computer: false })
}

export async function originalCombinedSession(agent: unknown, computer: unknown, host: unknown) {
  Reflect.set(globalThis, Symbol.for('cua-test-reference-browser-setup'), async () => agent)
  Reflect.set(globalThis, Symbol.for('cua-test-reference-computer'), computer)
  Reflect.set(globalThis, 'nodeRepl', host)
  const original = await import(await moduleUrl(sourceRoot))
  return original.create_tinysky_alt({
    browser: agent !== undefined,
    computer: computer !== undefined
  })
}

export async function originalConfiguredSession(
  setupBrowser: unknown,
  computer: unknown,
  host: unknown,
  options: unknown = {}
) {
  Reflect.set(globalThis, Symbol.for('cua-test-reference-browser-setup'), setupBrowser)
  Reflect.set(globalThis, Symbol.for('cua-test-reference-computer'), computer)
  Reflect.set(globalThis, 'nodeRepl', host)
  const original = await import(await moduleUrl(sourceRoot))
  return original.create_tinysky_alt(options)
}
