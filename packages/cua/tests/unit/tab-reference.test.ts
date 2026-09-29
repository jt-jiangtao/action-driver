// @vitest-environment node
import { expect, test } from 'vitest'
import { resolve } from 'node:path'
import { originalModule } from '../original-module'
import { parseTabMention, getMentionedBrowserId } from '../../src/tab-reference'
const entry = resolve(
  'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/tab_reference.js'
)
const url =
  'plugin://browser@openai-bundled/?mention=tab-v1&browserId=b&tabId=t&title=Title&url=https%3A%2F%2Fexample.com'
test('tab mention fields match the original contract', async () => {
  const ref = await originalModule(entry)
  for (const u of [url, url.replace('browser@', 'chrome@'), url + '&extra=ok'])
    expect(parseTabMention(u)).toEqual(ref.parse_tab_mention!(u))
})
test('invalid mention URLs and duplicate fields match original errors', async () => {
  const ref = await originalModule(entry)
  for (const u of [
    'bad',
    url.replace('openai-bundled', 'other'),
    url + '#hash',
    url + '&tabId=other',
    url.replace('tab-v1', 'tab-v2'),
    url.replace('browserId=b', 'browserId=')
  ]) {
    let expected
    try {
      ref.parse_tab_mention!(u)
    } catch (e) {
      expected = (e as Error).message
    }
    expect(() => parseTabMention(u)).toThrow(expected)
  }
})
test('resolves exactly one matching browser, rejects missing and ambiguous profiles', async () => {
  const ref = await originalModule(entry)
  const mention = parseTabMention(url.replace('browser@', 'chrome@'))
  for (const rows of [
    [],
    [{ id: 'x', type: 'extension', metadata: { extensionInstanceId: 'b' } }],
    [
      { id: 'x', type: 'extension', metadata: { extensionInstanceId: 'b' } },
      { id: 'y', type: 'extension', metadata: { extensionInstanceId: 'b' } }
    ]
  ]) {
    const provider = { list: async () => rows }
    const expected = await ref.get_mentioned_browser_id!(provider, mention).then(
      (value: string) => ({ value }),
      (e: Error) => ({ error: e.message })
    )
    const actual = await getMentionedBrowserId(provider, mention).then(
      (value) => ({ value }),
      (e: Error) => ({ error: e.message })
    )
    expect(actual).toEqual(expected)
  }
})
