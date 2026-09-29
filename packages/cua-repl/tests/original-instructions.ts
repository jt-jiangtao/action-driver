import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const vendor = resolve('thirdparty/backup/codex-cua/@oai/cua-repl')
export async function originalInstructions() {
  const source = await readFile(
    resolve(vendor, 'dist/lib/js/oai_js_cua_repl/src/instructions.js'),
    'utf8'
  )
  const resolver = `(specifier => ${JSON.stringify(pathToFileURL(resolve(vendor, 'instructions') + '/').href)} + specifier.slice('#instructions/'.length))`
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(source.replaceAll('import.meta.resolve', resolver)).toString('base64')
  )
}
