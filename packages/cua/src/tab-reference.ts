export interface TabMention {
  source: 'iab' | 'extension'
  browser_id: string
  tab_id: string
  title: string
  url: string
}
export function parseTabMention(value: string): TabMention {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Invalid tab mention URL.')
  }
  if (
    parsed.protocol !== 'plugin:' ||
    parsed.host !== 'openai-bundled' ||
    !['browser', 'chrome', 'chrome-dev', 'chrome-internal'].includes(parsed.username) ||
    parsed.password ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.hash
  )
    throw new Error('Invalid tab mention URL.')
  const fields = Object.fromEntries(parsed.searchParams)
  const { mention, source, browserId, tabId, title, url } = fields
  const surface = parsed.username === 'browser' ? (source ?? 'iab') : 'extension'
  if (
    mention !== 'tab-v1' ||
    parsed.searchParams.size !== Object.keys(fields).length ||
    (surface !== 'iab' && surface !== 'extension') ||
    !browserId?.trim() ||
    !tabId?.trim() ||
    title === undefined ||
    url === undefined
  )
    throw new Error('Invalid tab mention fields.')
  return { source: surface, browser_id: browserId, tab_id: tabId, title, url }
}
export async function getMentionedBrowserId(
  provider: {
    list(): Promise<
      Array<{ id: string; type?: string; metadata?: { extensionInstanceId?: string } }>
    >
  },
  mention: TabMention
): Promise<string> {
  const matches = (await provider.list()).filter(
    (browser) =>
      browser.type === mention.source &&
      (mention.source === 'iab' || browser.metadata?.extensionInstanceId === mention.browser_id)
  )
  if (matches.length !== 1)
    throw new Error(
      matches.length === 0
        ? 'The browser/profile referenced by the tab mention is unavailable.'
        : `Multiple browsers match the tab mention's browser/profile: ${JSON.stringify(matches)}`
    )
  return matches[0]!.id
}
