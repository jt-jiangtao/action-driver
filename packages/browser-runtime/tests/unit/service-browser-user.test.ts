// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserUser, readUserTabContext } from '../../src/service-browser-user'
import { originalDocumentation } from '../original-service'
test('user context validates page identity and falls back or includes selection/transcript as original', async () => {
  const base = await originalDocumentation()
  for (const expectedUrl of ['https://example.com', 'https://www.youtube.com/watch?v=abcdefghijk'])
    for (const selection of [
      null,
      { text: 'selected', truncated: false },
      { text: 'page', truncated: false }
    ])
      for (const valid of [true, false]) {
        async function exercise(readContext: any) {
          const calls: any[] = [],
            read = async (params: any) => {
              calls.push(params)
              if (params.kind === 'page')
                return {
                  url: valid ? expectedUrl : 'https://changed.example',
                  title: 'Title',
                  text: 'page',
                  truncated: false
                }
              if (params.kind === 'selection') return selection
              if (params.kind === 'youtubeTranscript')
                return { pageUrl: expectedUrl, text: 'transcript', truncated: true }
            }
          try {
            return { result: await readContext({ expectedUrl, read }), calls }
          } catch (e: any) {
            return { error: e.message, calls }
          }
        }
        expect(await exercise(readUserTabContext)).toEqual(
          await exercise(base.baselineReadUserContext)
        )
      }
})
test('workspace exports prioritize original formats, sanitize names and remove embedded markdown image definitions', async () => {
  const base = await originalDocumentation()
  for (const docType of ['document', 'presentation', 'spreadsheets'])
    for (const firstFails of [true, false]) {
      async function exercise(readContext: any) {
        const expectedUrl = `https://docs.google.com/${docType}/d/id/edit`,
          calls: any[] = [],
          read = async (params: any) => {
            calls.push(params)
            if (params.kind === 'page')
              return {
                url: expectedUrl,
                title: 'Report/2026 - Google Docs',
                text: 'page',
                truncated: false
              }
            if (params.kind === 'googleWorkspaceExport') {
              if (firstFails && calls.length === 2) return { errorMessage: 'unsupported' }
              return {
                base64: Buffer.from(' [image]: <data:image/png;base64,DATA>\n\nContent ').toString(
                  'base64'
                ),
                truncated: true
              }
            }
          }
        return { result: await readContext({ expectedUrl, read }), calls }
      }
      expect(await exercise(readUserTabContext)).toEqual(
        await exercise(base.baselineReadUserContext)
      )
    }
})
test('workspace export changed-page or size-limit errors remain fatal while unavailable formats fall back', async () => {
  const base = await originalDocumentation()
  for (const failure of [
    'The selected tab changed while being read',
    'Google Workspace export is too large for in-memory tab context',
    'unavailable'
  ]) {
    async function exercise(readContext: any) {
      const expectedUrl = 'https://docs.google.com/document/d/id/edit'
      try {
        return await readContext({
          expectedUrl,
          read: async (params: any) => {
            if (params.kind === 'page')
              return { url: expectedUrl, title: 'Title', text: 'page', truncated: false }
            throw Error(failure)
          }
        })
      } catch (e: any) {
        return e.message
      }
    }
    expect(await exercise(readUserTabContext)).toEqual(await exercise(base.baselineReadUserContext))
  }
})
test('browser user forwards claims and uses trusted PDF capture before backend content reads', async () => {
  const base = await originalDocumentation()
  for (const capture of [true, false]) {
    async function exercise(Type: any) {
      const calls: any[] = [],
        api = {
          getUserTabs: async () => [{ id: 1 }],
          claimUserTab: async (id: any) => {
            calls.push(['claim', id])
            return { id }
          },
          executeTabRead: async (params: any) => {
            calls.push(['read', params])
            return { url: 'https://example.com', title: 'Title', text: 'page', truncated: false }
          }
        },
        user = new Type(api, async (params: any) => {
          calls.push(['pdf', params])
          return capture ? { fileId: 'file', fileName: 'page.pdf' } : null
        })
      return {
        tabs: await user.openTabs(),
        claim: await user.claimTab(1),
        context: await user.getTabContext(1, 'https://example.com'),
        calls
      }
    }
    expect(await exercise(BrowserUser)).toEqual(await exercise(base.BaselineBrowserUser))
  }
})
