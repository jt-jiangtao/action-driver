import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { resolve, dirname, join } from 'node:path'
const require = createRequire(import.meta.url),
  root = resolve(import.meta.dirname, '../..'),
  sha = (value) => createHash('sha256').update(value).digest('hex')
const originalPath =
    'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs',
  readable = await readFile(
    resolve(
      root,
      'analysis/codex-cua/readable/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs'
    ),
    'utf8'
  )
const literal = readable
  .match(/^var AO =\n(.*)\nvar wY =/m)?.[1]
  ?.trim()
  .replace(/,$/, '')
if (!literal?.startsWith("'")) throw Error('Expected serialized source literal')
const original = runInNewContext(literal),
  packageRequire = createRequire(resolve(root, 'packages/browser-runtime/package.json')),
  packagePath = packageRequire.resolve('playwright-core/package.json'),
  version = packageRequire(packagePath).version
if (version !== '1.59.0') throw Error('Unexpected upstream version')
const generatedPath = join(dirname(packagePath), 'lib/generated/injectedScriptSource.js'),
  source = packageRequire(generatedPath).source,
  esbuild = require(resolve(root, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild'))
const wrapper = `var PlaywrightInjected = (() => { const module = { exports: {} }; return (() => { ${source} })(), { ...module.exports, InjectedScript: module.exports.InjectedScript() }; })();`,
  upstream = (await esbuild.transform(wrapper, { minify: true, loader: 'js', target: 'esnext' }))
    .code
// One insertion was located by whole-script diff, not inferred from API similarity.
const offset = 65621,
  length = 521,
  patch = original.slice(offset, offset + length),
  withoutPatch = original.slice(0, offset) + original.slice(offset + length)
if (
  !patch.startsWith('(function(f,u){const p=f.tagName.toLowerCase();') ||
  !patch.endsWith(':') ||
  withoutPatch !== upstream
)
  throw Error('Whole-source comparison failed')
const evidence = {
  originalPath,
  originalFileSha256: sha(await readFile(resolve(root, originalPath))),
  originalInjectedSha256: sha(original),
  upstream: {
    package: 'playwright-core',
    version,
    registry: 'https://registry.npmjs.org/playwright-core/1.59.0',
    generatedFileSha256: sha(await readFile(generatedPath)),
    serializedSourceSha256: sha(source)
  },
  normalization: { tool: 'esbuild', version: '0.28.2', minify: true, target: 'esnext' },
  patch: {
    offset,
    length,
    sha256: sha(patch),
    purpose: 'redact sensitive input/textarea ARIA values'
  },
  normalizedUpstreamSha256: sha(upstream),
  wholeSourceEqualsAfterRemovingOnlyPatch: true
}
await writeFile(
  resolve(root, 'analysis/codex-cua/playwright-injected-provenance.json'),
  JSON.stringify(evidence, null, 2) + '\n'
)
console.log(
  JSON.stringify({ version, patchLength: length, wholeSourceEqualsAfterRemovingOnlyPatch: true })
)
