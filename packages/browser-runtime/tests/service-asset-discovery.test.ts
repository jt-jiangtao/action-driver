// @vitest-environment node
import { test, expect } from 'vitest'
import { discoverPageAssets, discoverInlineSvgs } from '../src/service-asset-discovery'
import { originalDocumentation } from './original-service'
test('resource inventory classifies names, hashes ids and merges only observed DOM resources', async () => {
  const base = await originalDocumentation()
  for (const hasDocument of [true, false]) {
    const snapshot = {
        strings: [
          'https://example.com/page',
          'IMG',
          'src',
          '/image.png',
          'srcset',
          '/image.png 1x, /other.png 2x',
          'url("/image.png")',
          '',
          'LINK',
          'href',
          '/style.css',
          'rel',
          'stylesheet'
        ],
        documents: hasDocument
          ? [
              {
                documentURL: 0,
                nodes: {
                  backendNodeId: [1, 2],
                  nodeName: [1, 8],
                  attributes: [
                    [2, 3, 4, 5],
                    [9, 10, 11, 12]
                  ]
                },
                layout: { nodeIndex: [0], styles: [[6, 7, 7, 7, 7]] }
              }
            ]
          : []
      },
      resources = [
        { name: 'https://example.com/image.png', initiatorType: 'img' },
        { name: 'https://example.com/style.css', initiatorType: 'css' },
        { name: 'https://example.com/unknown#icon', initiatorType: 'font' },
        { name: 'https://example.com/module.mjs', initiatorType: 'other' }
      ],
      cdp = { call: async () => snapshot, evaluateJavascript: async () => resources }
    expect(await discoverPageAssets({ cdp, tabId: 1 })).toEqual(
      await base.baselineDiscoverAssets({ cdp, tabId: 1 })
    )
  }
})
test('asset kinds and DOM attribute sources match original varied tag rules', async () => {
  const base = await originalDocumentation()
  for (const tag of ['source', 'video', 'script', 'link', 'use']) {
    const snapshot = {
        strings: [
          'https://example.com/page',
          tag,
          'src',
          '/asset',
          'poster',
          '/poster',
          'href',
          '/asset',
          'xlink:href',
          '/asset',
          'srcset',
          '/asset 1x'
        ],
        documents: [
          {
            documentURL: 0,
            nodes: {
              backendNodeId: [1],
              nodeName: [1],
              attributes: [[2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]
            },
            layout: { nodeIndex: [], styles: [] }
          }
        ]
      },
      cdp = {
        call: async () => snapshot,
        evaluateJavascript: async () => [
          { name: 'https://example.com/asset' },
          { name: 'https://example.com/poster' }
        ]
      }
    expect(await discoverPageAssets({ cdp, tabId: 1 })).toEqual(
      await base.baselineDiscoverAssets({ cdp, tabId: 1 })
    )
  }
})
test('inline SVG inventories skip empty markup and hash index plus markup', async () => {
  const base = await originalDocumentation(),
    cdp = {
      evaluateJavascript: async () => [
        { markup: '<svg/>', name: 'Icon' },
        { markup: '', name: 'Empty' },
        { markup: '<svg><title>Logo</title></svg>', name: '' }
      ]
    }
  expect(await discoverInlineSvgs({ cdp, tabId: 1 })).toEqual(
    await base.baselineDiscoverInlineSvg({ cdp, tabId: 1 })
  )
})
