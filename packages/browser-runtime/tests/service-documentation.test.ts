// @vitest-environment node
import { test, expect } from 'vitest'
import { BrowserDocumentation } from '../src/service-documentation'
import { originalDocumentation } from './original-service'
test('browser docs use actual packaged manifest, capability metadata, exclusions and disabled API members', async () => {
  const { BaselineDocumentation, baselineResources } = await originalDocumentation()
  for (const environment of ['codex-app', 'training', 'cloud', 'orbit'])
    for (const type of ['iab', 'extension', 'cdp']) {
      async function exercise(Type: any) {
        const resource = baselineResources.environments?.[environment] ?? baselineResources.default,
          calls: string[] = []
        const docs = new Type({
          apiManifest: resource.apiManifest,
          documentManifest: resource.documentManifest,
          disabledMemberIds: new Set(['Tab.ax']),
          undocumentedApiMembers: ['Browser.history'],
          excludedDocumentation: ['confirmations'],
          addendum: 'custom addendum',
          readDocumentation: async (name: string) => {
            calls.push(name)
            return resource.documentation[name]
          }
        })
        const text = await docs.readBrowser({
          id: 'browser',
          name: 'B',
          type,
          capabilities: {
            browser: [{ id: 'visibility' }, { id: 'viewport' }, { id: 'unknown' }],
            tab: [{ id: 'cdp' }, { id: 'browserAuth' }]
          }
        })
        return { text, calls, read: [...docs.readNames], keys: Object.keys(docs) }
      }
      expect(await exercise(BrowserDocumentation)).toEqual(await exercise(BaselineDocumentation))
    }
})
test('documentation required-command gates clear only after successful reads and preserve exact error messages', async () => {
  const { BaselineDocumentation } = await originalDocumentation()
  async function exercise(Type: any) {
    let fail = true
    const docs = new Type({
      apiManifest: {},
      disabledMemberIds: new Set(),
      documentManifest: [
        { name: 'auth', requiredFor: ['action'] },
        { name: 'other', requiredFor: ['action'] }
      ],
      readDocumentation: async (name: string) => {
        if (fail) throw new Error('read')
        return name
      }
    })
    const errors = []
    for (let step = 0; step < 4; step++) {
      try {
        docs.assertRequiredDocumentationRead('action')
      } catch (e: any) {
        errors.push(e.message)
      }
      try {
        await docs.read(step % 2 ? 'other' : 'auth')
      } catch (e: any) {
        errors.push(e.message)
      }
      fail = false
    }
    try {
      await docs.read('bad')
    } catch (e: any) {
      errors.push(e.message)
    }
    return { errors, read: [...docs.readNames] }
  }
  expect(await exercise(BrowserDocumentation)).toEqual(await exercise(BaselineDocumentation))
})
