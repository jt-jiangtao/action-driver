import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
const entry = resolve(
  'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_cua/src/cua.js'
)
let sequence = 0
async function encode(path: string, key: string): Promise<string> {
  let source = await readFile(path, 'utf8')
  if (path === entry) {
    source = source.replace(
      /import\{setupBrowserRuntime as s\}from"[^"]+";/,
      `const s=globalThis[Symbol.for(${JSON.stringify(key)})].setup;`
    )
    source = source.replace(
      /import\{sky as r\}from"[^"]+";/,
      `const r=globalThis[Symbol.for(${JSON.stringify(key)})].computer;`
    )
  }
  for (const match of [...source.matchAll(/from\s*["'](\.[^"']+)["']/g)]) {
    source = source.replace(
      match[0],
      `from ${JSON.stringify(await encode(resolve(dirname(path), match[1]!), key))}`
    )
  }
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
}
export async function originalLegacyFacade(setup: unknown, computer: unknown) {
  const key = `cua-reference-legacy-${sequence++}`
  Reflect.set(globalThis, Symbol.for(key), { setup, computer })
  try {
    return (await import(await encode(entry, key))).cua
  } finally {
    Reflect.deleteProperty(globalThis, Symbol.for(key))
  }
}
