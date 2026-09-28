// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDocumentationReader } from '../src/documentation'
const vendor = resolve('packages/back/codex-cua/@oai/cua')
const entry = resolve(vendor, 'dist/lib/js/oai_js_cua/src/tinysky_alt/documentation.js')
async function reference() {
  let source = await readFile(entry, 'utf8')
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(entry).href))
  const path = resolve(vendor, 'dist/lib/js/oai_js/node_modules/tslib/tslib.es6.js')
  const helper =
    'data:text/javascript;base64,' + Buffer.from(await readFile(path, 'utf8')).toString('base64')
  source = source.replace('../../../oai_js/node_modules/tslib/tslib.es6.js', helper)
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
test('packaged documentation matches the original content', async () => {
  const ref = await reference()
  const docs = createDocumentationReader()
  for (const source of [
    'confirmations',
    'core-cua-repl',
    'core-node-repl',
    'other-browser-apis'
  ] as const)
    expect(await docs.readDocumentation(source)).toBe(await ref.read_documentation(source))
})
test('confirmation policies match byte limits and fallback behavior', async () => {
  const ref = await reference()
  let meta: unknown
  const docs = createDocumentationReader({ getRequestMeta: () => meta })
  const globals = globalThis as typeof globalThis & { nodeRepl?: unknown }
  const saved = globals.nodeRepl
  try {
    for (const value of [
      undefined,
      null,
      [],
      {},
      'policy',
      { 'openai/confirmation_policies': [] },
      { 'openai/confirmation_policies': { computer_use: '' } },
      { 'openai/confirmation_policies': { computer_use: '  ' } },
      { 'openai/confirmation_policies': { computer_use: 'custom' } },
      { 'openai/confirmation_policies': { computer_use: 'é'.repeat(6000) } },
      { 'openai/confirmation_policies': { computer_use: 'é'.repeat(6001) } }
    ]) {
      meta = value
      globals.nodeRepl = { requestMeta: value }
      expect(await docs.readComputerUseConfirmationPolicy()).toBe(
        await ref.read_computer_use_confirmation_policy()
      )
    }
  } finally {
    if (saved === undefined) delete globals.nodeRepl
    else globals.nodeRepl = saved
  }
})
test('document sources cannot escape packaged resources', async () => {
  await expect(createDocumentationReader().readDocumentation('../package')).rejects.toThrow(
    'Unknown documentation source'
  )
})

test('default documentation reader ignores ambient private request metadata', async () => {
  const previous = Reflect.get(globalThis, 'nodeRepl')
  Reflect.set(globalThis, 'nodeRepl', {
    requestMeta: { 'openai/confirmation_policies': { computer_use: 'private policy' } }
  })
  try {
    expect(await createDocumentationReader().readComputerUseConfirmationPolicy())
      .toBe(await createDocumentationReader().readDocumentation('confirmations'))
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'nodeRepl')
    else Reflect.set(globalThis, 'nodeRepl', previous)
  }
})
