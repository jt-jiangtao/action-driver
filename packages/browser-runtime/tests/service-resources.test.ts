// @vitest-environment node
import { test, expect } from 'vitest'
import {
  readBrowserDocument,
  readApiManifest,
  readDocumentManifest,
  readBrowserGuidance
} from '../src/service-resources'
import { originalDocumentation } from './original-service'
test('packaged data preserves original manifests and every named document across supported environments', async () => {
  const base = await originalDocumentation()
  for (const environment of ['codex-app', 'training', 'cloud', 'orbit']) {
    expect(await readApiManifest(undefined, { environment })).toEqual(
      await base.baselineReadApi(undefined, { environment })
    )
    expect(await readDocumentManifest(undefined, { environment })).toEqual(
      await base.baselineReadDocumentManifest(undefined, { environment })
    )
    for (const name of Object.keys(base.baselineResources.default.documentation))
      expect(await readBrowserDocument(name, undefined, { environment })).toBe(
        await base.baselineReadDocument(name, undefined, { environment })
      )
  }
})
test('document name safety and missing docs preserve original errors', async () => {
  const base = await originalDocumentation()
  for (const name of [
    '../escape',
    'a.md',
    '/absolute',
    'a//b',
    'a/',
    '',
    null,
    'constructor',
    'missing'
  ]) {
    let expected
    try {
      await base.baselineReadDocument(name)
    } catch (e: any) {
      expected = e.message
    }
    await expect(readBrowserDocument(name as any)).rejects.toThrow(expected)
  }
})
test('explicit file root bypasses packaged data and parses custom manifests', async () => {
  const base = await originalDocumentation()
  async function exercise(readDoc: any, readApi: any, readManifest: any) {
    const calls: string[] = [],
      filesystem = {
        readFile: async (url: URL) => {
          calls.push(url.href)
          return url.pathname.endsWith('.md') ? 'custom' : '{"custom":true}'
        }
      },
      options = { root: new URL('file:///custom/') }
    return {
      doc: await readDoc('nested/doc', filesystem, options),
      api: await readApi(filesystem, options),
      manifest: await readManifest(filesystem, options),
      calls
    }
  }
  expect(await exercise(readBrowserDocument, readApiManifest, readDocumentManifest)).toEqual(
    await exercise(
      base.baselineReadDocument,
      base.baselineReadApi,
      base.baselineReadDocumentManifest
    )
  )
})
test('guidance handles orbit alias, supported overrides and cloud AX substitutions', async () => {
  const base = await originalDocumentation()
  for (const environment of ['codex-app', 'cloud', 'orbit'])
    for (const name of [
      'cloud-auth',
      'capabilities/tab/browserAuth',
      'screenshots',
      'confirmations'
    ])
      for (const override of [false, true]) {
        const host = {
          env: { BROWSER_USE_TINYSKY_ENABLED: '1' },
          gaas: {
            browserConfig: { instruction_overrides: override ? { [name]: 'custom guidance' } : {} }
          }
        }
        async function result(read: any) {
          try {
            return { value: await read(host, name, undefined, { environment }) }
          } catch (error: any) {
            return { error: error.message }
          }
        }
        expect(await result(readBrowserGuidance)).toEqual(await result(base.baselineReadGuidance))
      }
})
