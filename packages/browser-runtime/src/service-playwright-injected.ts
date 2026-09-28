import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
export function protectedField(element: Element) {
  const tag = element.tagName.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false
  if (element.getAttribute('type')?.toLowerCase() === 'hidden') return true
  let attributes = ''
  for (const name of ['type', 'autocomplete', 'id', 'name', 'placeholder', 'aria-label', 'title'])
    attributes += ` ${element.getAttribute(name) ?? ''}`
  return /user[-_ ]?name|e[-_ ]?mail|one[-_ ]?time[-_ ]?code|password|passcode|passwd|\botp\b|\b(?:2fa|mfa)\b|phone|mobile|\btel\b/i.test(
    attributes
  )
}
/** Own credential-redaction patch over the unchanged, pinned third-party source. */
export function patchPlaywrightSource(source: string) {
  const needle = 'result.children = [element.value];'
  if (source.split(needle).length !== 2)
    throw Error('Playwright credential patch point is missing or ambiguous')
  return source.replace(
    needle,
    `result.children = [(${protectedField.toString()})(element) ? (element.value ? "<redacted>" : "") : element.value];`
  )
}
let cached: string | undefined
export function playwrightInjectedSource() {
  if (cached != null) return cached
  const path = require.resolve('playwright-core/package.json'),
    metadata = require(path) as { version: string }
  if (metadata.version !== '1.59.0')
    throw Error(`Unsupported Playwright injected helper version: ${metadata.version}`)
  const source = (
    require(join(dirname(path), 'lib/generated/injectedScriptSource.js')) as { source: string }
  ).source
  cached = `var PlaywrightInjected = (() => { const __name = (target) => target; const module = { exports: {} }; return (() => { ${patchPlaywrightSource(source)} })(), { ...module.exports, InjectedScript: module.exports.InjectedScript() }; })();`
  return cached
}
