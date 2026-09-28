// @vitest-environment node
import { expect, test } from 'vitest'
import {
  TabCdpCommands,
  TabBotDetectionCommands,
  TabsContent,
  BrowserUserGetTabContext
} from '../src/commands/structured'
import { originalClient } from './original-client'
const records = [
  [
    'cdp-call',
    TabCdpCommands.Call,
    (a: any) => a.TabCdpCommands.Call,
    { browser_id: 'b', tab_id: 't', method: 'Runtime.evaluate' },
    [
      null,
      {},
      { browser_id: 1, tab_id: 't', method: '' },
      { browser_id: 'b', tab_id: 't', method: 'x', target: {} },
      { browser_id: 'b', tab_id: 't', method: 'x', target: { session_id: 's', target_id: 't' } },
      { browser_id: 'b', tab_id: 't', method: 'x', timeout_ms: 0 }
    ]
  ],
  [
    'cdp-events',
    TabCdpCommands.Events,
    (a: any) => a.TabCdpCommands.Events,
    { browser_id: 'b', tab_id: 't', limit: 1000, after_sequence: 0 },
    [
      { browser_id: 'b', tab_id: 't', limit: 1001 },
      { browser_id: 'b', tab_id: 't', methods: [] },
      { browser_id: 'b', tab_id: 't', after_sequence: -1 }
    ]
  ],
  [
    'bot',
    TabBotDetectionCommands.Report,
    (a: any) => a.TabBotDetectionCommands.Report,
    { browser_id: 'b', tab_id: 't', reason: 'captcha_failed' },
    [{ browser_id: 'b', tab_id: 't', reason: 'unknown' }]
  ],
  [
    'content',
    TabsContent,
    (a: any) => a.Commands.TabsContent,
    { browser_id: 'b', urls: [], content_type: 'text' },
    [
      { browser_id: 'b', urls: ['x'], content_type: 'invalid' },
      { browser_id: 'b', urls: ['x'], content_type: 'text', timeout_ms: 0 }
    ]
  ],
  [
    'context',
    BrowserUserGetTabContext,
    (a: any) => a.Commands.BrowserUserGetTabContext,
    { browser_id: 'b', tab_id: 't' },
    [{ browser_id: 'b', tab_id: null }]
  ]
] as const
function outcome(schema: any, value: unknown) {
  try {
    return { value: schema.parse(value) }
  } catch (error: any) {
    return { issues: error.issues, message: error.message, name: error.name }
  }
}
for (const [name, own, getBaseline, valid, invalid] of records) {
  test(`${name} payload strips extras and matches baseline success/error`, async () => {
    const { baselineApi } = await originalClient(),
      ref = getBaseline(baselineApi)
    for (const input of [{ ...valid, extra: 1 }, ...invalid])
      expect(outcome(own.PayloadSchema, input)).toEqual(outcome(ref.PayloadSchema, input))
    expect(own.commandType).toBe(ref.commandType)
    const cmd = own.create({ ...valid, extra: 1 } as any),
      original = ref.create({ ...valid, extra: 1 })
    expect(cmd.toJSON()).toEqual(original.toJSON())
    expect(cmd.parse()).toEqual(original.parse())
  })
}
for (const [name, own, getBaseline, values] of [
  [
    'cdp-call',
    TabCdpCommands.Call,
    (a: any) => a.TabCdpCommands.Call,
    [undefined, null, 1, { extra: 1 }]
  ],
  [
    'cdp-events',
    TabCdpCommands.Events,
    (a: any) => a.TabCdpCommands.Events,
    [
      { cursor: 0, events: [], hasMore: false, truncated: false, extra: 1 },
      {
        cursor: 1,
        events: [
          { sequence: 1, source: { tabId: 2, extra: 1 }, method: 'x', params: { a: 1 }, extra: 1 }
        ],
        hasMore: true,
        truncated: false
      },
      { cursor: -1, events: [], hasMore: 0 },
      {
        cursor: 0,
        events: [{ sequence: 0, source: {}, method: '' }],
        hasMore: false,
        truncated: false
      }
    ]
  ],
  [
    'bot',
    TabBotDetectionCommands.Report,
    (a: any) => a.TabBotDetectionCommands.Report,
    [
      { status: 'reported', hostname: null, extra: 1 },
      { status: 'reported', hostname: 'host' },
      { status: 'bad' }
    ]
  ],
  [
    'content',
    TabsContent,
    (a: any) => a.Commands.TabsContent,
    [{ results: [{ url: 'x', title: null, content: 'hi', extra: 1 }] }, { results: [{ url: 1 }] }]
  ],
  [
    'context',
    BrowserUserGetTabContext,
    (a: any) => a.Commands.BrowserUserGetTabContext,
    [
      { kind: 'text', text: 'hi', title: 't', truncated: false, url: 'x', extra: 1 },
      {
        kind: 'document',
        dataBase64: 'YQ==',
        fileName: 'x',
        mimeType: 'text/plain',
        title: 't',
        url: 'x'
      },
      {
        kind: 'library_file',
        libraryFileId: 'lib',
        fileId: 'id',
        fileName: 'x',
        mimeType: 'a',
        title: 't',
        url: 'x'
      },
      { kind: 'bad' },
      { kind: 'library_file', libraryFileId: '' }
    ]
  ]
] as const)
  test(`${name} structured results match original schema`, async () => {
    const { baselineApi } = await originalClient(),
      ref = getBaseline(baselineApi)
    for (const input of values)
      expect(outcome(own.ResultSchema, input)).toEqual(outcome(ref.ResultSchema, input))
  })
