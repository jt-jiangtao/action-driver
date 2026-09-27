import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

const DEFAULT_MAX_CHARACTERS = 12_000

export type ExtractedPage = {
  title: string
  url: string
  text: string
  truncated: boolean
}

export function extractPageText(
  html: string,
  url: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS
): ExtractedPage {
  const dom = new JSDOM(html, { url })
  try {
    const document = dom.window.document
    const article = new Readability(document.cloneNode(true) as Document, {
      charThreshold: 80,
      maxElemsToParse: 20_000
    }).parse()
    const articleText = normalizeText(article?.textContent ?? '')
    const text = articleText.length >= 80 ? articleText : fallbackText(document)
    if (!text) throw new Error('WEB_OPEN_EMPTY_CONTENT')
    const characters = Array.from(text)
    const heading = normalizeText(
      document.querySelector('article h1, main h1, h1')?.textContent ?? ''
    )
    const title =
      heading ||
      normalizeText(article?.title ?? '') ||
      normalizeText(document.title) ||
      new URL(url).hostname
    return {
      title: Array.from(title).slice(0, 256).join(''),
      url,
      text: characters.slice(0, maxCharacters).join(''),
      truncated: characters.length > maxCharacters
    }
  } finally {
    dom.window.close()
  }
}

function fallbackText(document: Document): string {
  const body = document.body?.cloneNode(true) as HTMLElement | undefined
  if (!body) return ''
  for (const element of body.querySelectorAll(
    'script, style, nav, footer, header, aside, noscript, iframe, svg, form'
  ))
    element.remove()
  return normalizeText(body.textContent ?? '')
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}
