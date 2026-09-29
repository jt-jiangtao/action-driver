// @vitest-environment node
import { expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatRichTextHtml, renderRichTextHtml, richTextClipboardItems, richTextAllowed } from '../../src/service-rich-text'
import { originalDocumentation } from '../original-service'

test('rich-text whitespace and paragraph flattening match original around renderer output', async () => {
  const original = await originalDocumentation()
  for (const source of [
    '', ' ', '  plain  ', '\nplain\n', '\r\nplain\u2028',
    'first\nsecond', '# Title', '**bold**', '<script>alert(1)</script>',
    '  **bold**  ', '\u00a0paragraph\u00a0', 'line  \nnext'
  ]) {
    const rendered = original.baselineMarkdownRenderer.render(source)
    expect(formatRichTextHtml(rendered, source)).toEqual(
      original.baselineRichTextWhitespace(rendered, source)
    )
  }
})

test('renderer seam composes the original Markdown result with owned HTML formatting', async () => {
  const original = await originalDocumentation()
  for (const source of ['', '  plain  ', '\n**bold**\n', '# Title', 'line  \nnext'])
    expect(renderRichTextHtml(source, (value) => original.baselineMarkdownRenderer.render(value)))
      .toBe(original.baselineRichTextHtml(source))
})

test('pinned Markdown renderer matches the original bundled parser on rich clipboard inputs', async () => {
  const original = await originalDocumentation()
  const candidate = await import('../../src/service-rich-text') as any
  expect(typeof candidate.renderMarkdownRichText).toBe('function')
  for (const source of [
    '', '  plain  ', '\n**bold**\n', '# Title', 'line  \nnext',
    '<script>alert(1)</script>', '![alt\ntext](https://example.com/a.png)',
    '&notit;', '# heading\u2003', 'para\u2003', '\\ \nnext',
    '[link](https://example.com/path)', '`<b>`', 'a|b\n-| -\nx|y'
  ])
    expect(candidate.renderMarkdownRichText(source)).toBe(original.baselineRichTextHtml(source))
})

test('bundled linkify fingerprint distinguishes the pinned 14.1.1 fix from 14.1.0', async () => {
  const bundle = await readFile(resolve(
    'thirdparty/backup/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs'
  ), 'utf8')
  const start = bundle.indexOf('var Zj=/(?:^|[^a-z0-9.+-])')
  expect(start).toBeGreaterThan(0)
  const linkify = bundle.slice(start, start + 1100)
  expect(linkify).toContain('a.charCodeAt(u-1)===42')
  expect(linkify).not.toContain('a.replace(/\\*+$/')
})

test('pinned rich text rendering agrees with the original across a deterministic mixed-markup corpus', async () => {
  const original = await originalDocumentation()
  const { renderMarkdownRichText } = await import('../../src/service-rich-text')
  const tokens = ['plain', '**', '_', '`', '# ', '\n', '  ', '&copy;', '<b>',
    '[x](https://example.com)', '![a](x.png)', '\u00a0', '\u2003', '\\', '|', '> ']
  let seed = 0x5eeda11
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
  for (let index = 0; index < 96; index++) {
    let source = ''
    for (let part = 0, count = 2 + next() % 8; part < count; part++)
      source += tokens[next() % tokens.length]
    expect(renderMarkdownRichText(source), `sample ${index}: ${JSON.stringify(source)}`)
      .toBe(original.baselineRichTextHtml(source))
  }
})

test('clipboard entries and Google Sheets exclusion match original', async () => {
  const original = await originalDocumentation()
  for (const input of [
    ['', undefined],
    ['plain', undefined],
    ['**bold**', '<strong>bold</strong>'],
    ['line\nnext', 'line<br>next']
  ] as const) {
    const [source, html] = input
    expect(richTextClipboardItems(source, html)).toEqual(
      original.baselineRichTextClipboardItems(source, html !== undefined)
        .map((item: any) => ({ ...item, entries: item.entries.map((entry: any) =>
          entry.mime_type === 'text/html' ? { ...entry, text: html } : entry) }))
    )
  }
  for (const url of [
    undefined, '', 'https://docs.google.com/spreadsheets/d/123',
    'https://docs.google.com/document/d/123',
    'https://docs.google.com/presentation/d/123',
    'https://example.com/spreadsheets/d/123',
    'https://docs.google.com/spreadsheets-v2/d/123'
  ]) expect(richTextAllowed(url)).toBe(original.baselineRichTextAllowed(url))
})
