import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
// Test-only loader for the small, acyclic baseline helpers used by these cases.
// Never used by a candidate implementation or production runtime.
export async function originalModule(
  path: string
): Promise<Record<string, (...args: any[]) => any>> {
  let source = await readFile(path, 'utf8')
  const imports = [...source.matchAll(/from\s*["'](\.[^"']+)["']/g)]
  for (const match of imports) {
    const relative = match[1]!
    const url = await moduleUrl(resolve(dirname(path), relative))
    source = source.replace(match[0], `from ${JSON.stringify(url)}`)
  }
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
async function moduleUrl(path: string): Promise<string> {
  let s = await readFile(path, 'utf8')
  for (const m of [...s.matchAll(/from\s*["'](\.[^"']+)["']/g)])
    s = s.replace(m[0], `from ${JSON.stringify(await moduleUrl(resolve(dirname(path), m[1]!)))}`)
  return 'data:text/javascript;base64,' + Buffer.from(s).toString('base64')
}
