function edgeWhitespace(chars: Iterable<string>, reverse = false): string {
  const encoded: string[] = []
  for (const char of chars) {
    if (/[\r\n\u2028\u2029]/.test(char)) encoded.push('<br>')
    else if (/\s/.test(char)) encoded.push('&nbsp;')
    else break
  }
  return (reverse ? encoded.reverse() : encoded).join('')
}

/** Preserve source leading/trailing whitespace around the rendered HTML body. */
export function formatRichTextHtml(rendered: string, source: string): string {
  let html = rendered.trim()
  if (source.trim().length === 0) return edgeWhitespace(source)
  const leading = edgeWhitespace(source)
  const trailing = edgeWhitespace(Array.from(source).reverse(), true)
  if (html.startsWith('<p>') && html.endsWith('</p>')) {
    const inner = html.slice(3, -4)
    if (!inner.includes('<p>')) html = leading + inner + trailing
  }
  return html === rendered.trim() ? leading + html + trailing : html
}

/** Compose owned HTML whitespace handling with an injectable renderer for parity tests. */
export function renderRichTextHtml(source: string, render: (text: string) => string): string {
  return formatRichTextHtml(render(source), source)
}

/** Exact upstream renderer identified by bundled linkify code and output boundaries. */
export function renderMarkdownRichText(source: string): string {
  return renderRichTextHtml(source, (text) => markdownRenderer.render(text))
}

/** Native paste sees plain text first and optional HTML second. */
export function richTextClipboardItems(text: string, html?: string) {
  return [{
    entries: [
      { mime_type: 'text/plain', text },
      ...(html === undefined ? [] : [{ mime_type: 'text/html', text: html }])
    ],
    presentation_style: 'unspecified'
  }]
}

/** Google Sheets cells require plain text; other pages accept formatted paste. */
export function richTextAllowed(value: string | undefined): boolean {
  if (value == null) return true
  let url: URL
  try { url = new URL(value) } catch { return true }
  return !(url.host === 'docs.google.com' &&
    url.pathname.split('/').filter(Boolean)[0] === 'spreadsheets')
}
import { createRequire } from 'node:module'

interface MarkdownRenderer { render(source: string): string }
const MarkdownIt = createRequire(import.meta.url)('markdown-it') as
  (options: { breaks: boolean; html: boolean; linkify: boolean; typographer: boolean }) => MarkdownRenderer
const markdownRenderer = MarkdownIt({ breaks: true, html: false, linkify: false, typographer: false })
