// @vitest-environment node
import { expect, test } from 'vitest'
import {
  TabBrowserAuthCommands,
  TabPageAssetsCommands,
  WebMcpListTools,
  WebMcpInvokeTool
} from '../src/commands/capability'
import { originalClient } from './original-client'
function outcome(schema: any, value: unknown) {
  try {
    return { value: schema.parse(value) }
  } catch (e: any) {
    return { issues: e.issues, message: e.message }
  }
}
const rows = [
  [
    'auth',
    TabBrowserAuthCommands.Handoff,
    (a: any) => a.TabBrowserAuthCommands.Handoff,
    [
      { origin: 'x', fields: [], qr_code: true, browser_id: 'b', tab_id: 't' },
      { origin: 'x', fields: [], browser_id: 'b', tab_id: 't' },
      {
        origin: 'x',
        fields: [{ id: '__proto__', label: 'x', type: '', required: true, selector: '#x' }],
        browser_id: 'b',
        tab_id: 't'
      },
      {
        origin: 'x',
        fields: [],
        options: [
          { id: 'a', label: ' A ', selector: '#a' },
          { id: 'b', label: 'B', field_ids: ['x'] }
        ],
        browser_id: 'b',
        tab_id: 't'
      }
    ],
    [
      { status: 'submitted', extra: 1 },
      {
        status: 'locator_invalid',
        locator_error: { field_id: 'x', reason: 'not_user_visible' },
        reason: 'user_took_over'
      },
      { status: 'invalid' }
    ]
  ],
  [
    'assets-list',
    TabPageAssetsCommands.List,
    (a: any) => a.TabPageAssetsCommands.List,
    [{ browser_id: 'b', tab_id: 't' }],
    [
      {
        id: 'inventory',
        assets: [],
        inlineSvgs: [],
        pageUrl: null,
        summary: { byKind: {}, inlineSvgCount: 0, totalCount: 0 }
      },
      {
        id: 'i',
        assets: [
          {
            id: 'a',
            kind: 'image',
            name: 'a',
            sources: [{ kind: 'attribute', nodeId: 1 }],
            url: 'x'
          }
        ],
        inlineSvgs: [{ id: 's', markup: 'svg', name: 's' }],
        pageUrl: 'x',
        summary: { byKind: { image: 1 }, inlineSvgCount: 1, totalCount: 1 }
      },
      {}
    ]
  ],
  [
    'assets-bundle',
    TabPageAssetsCommands.Bundle,
    (a: any) => a.TabPageAssetsCommands.Bundle,
    [
      { browser_id: 'b', tab_id: 't', inventoryId: 'i', kinds: ['image'] },
      { browser_id: 'b', tab_id: 't', inventoryId: 'i', kinds: ['script'] }
    ],
    [
      {
        assets: [],
        directoryPath: 'd',
        failures: [],
        manifestPath: 'm',
        summary: { downloadedCount: 0, elapsedMs: 0, failedCount: 0, requestedCount: 0 }
      },
      {}
    ]
  ],
  [
    'web-list',
    WebMcpListTools,
    (a: any) => a.Commands.WebMcpListTools,
    [{ browser_id: 'b', tab_id: 't' }],
    [
      {
        tools: [
          {
            name: 'x',
            call_name: 'alias',
            registration_id: 'r',
            input_schema: {},
            annotations: { readOnlyHint: true, extra: 1 },
            extra: 1
          }
        ]
      },
      { tools: [{ name: 1 }] }
    ]
  ],
  [
    'web-call',
    WebMcpInvokeTool,
    (a: any) => a.Commands.WebMcpInvokeTool,
    [
      { browser_id: 'b', tab_id: 't', tool_name: 'x', registration_id: 'r', input: 1 },
      { browser_id: 'b', tab_id: 't', tool_name: 'x', registration_id: 'r', timeout_ms: 0 }
    ],
    [{ result: 1, extra: 1 }, {}, null]
  ]
] as const
for (const [name, own, reference, payloads, results] of rows)
  test(`${name} schemas match original success and error structures`, async () => {
    const { baselineApi } = await originalClient(),
      ref = reference(baselineApi)
    expect(own.commandType).toBe(ref.commandType)
    for (const payload of [...payloads, null, {}, { extra: true }])
      expect(outcome(own.PayloadSchema, payload)).toEqual(outcome(ref.PayloadSchema, payload))
    for (const result of results)
      expect(outcome(own.ResultSchema, result)).toEqual(outcome(ref.ResultSchema, result))
  })
