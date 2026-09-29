// @vitest-environment node
import { test, expect } from 'vitest'
import {
  approveHistory,
  approveFileTransfer,
  approveFullCdp,
  approvePageAssets,
  approveAssetOrigin
} from '../../src/service-approval-gates'
import { originalDocumentation } from '../original-service'
function details(error: any) {
  return { message: error.message, reason: error.reason, retryable: error.retryable }
}
const fixtures = [
  {
    name: 'history',
    candidate: approveHistory,
    baseline: 'baselineHistoryApproval',
    args: [{ limit: 5 }, 'iab']
  },
  {
    name: 'download',
    candidate: approveFileTransfer,
    baseline: 'baselineFileApproval',
    args: ['download', 'https://example.com/path']
  },
  {
    name: 'upload',
    candidate: approveFileTransfer,
    baseline: 'baselineFileApproval',
    args: ['upload', 'https://example.com/path']
  },
  {
    name: 'CDP',
    candidate: approveFullCdp,
    baseline: 'baselineCdpApproval',
    args: ['https://example.com/path']
  },
  {
    name: 'assets',
    candidate: approvePageAssets,
    baseline: 'baselineAssetsApproval',
    args: ['https://example.com/path']
  },
  {
    name: 'cross-origin asset',
    candidate: approveAssetOrigin,
    baseline: 'baselineAssetOriginApproval',
    args: ['https://example.com/path', 'https://cdn.example.com/image.png']
  }
]
for (const fixture of fixtures)
  test(`${fixture.name} approval preserves saved decisions, request metadata and result/error behavior`, async () => {
    const base = await originalDocumentation()
    for (const saved of [
      null,
      { decision: 'approve', scope: 'global', source: 'browser-use-persisted-state' },
      { decision: 'deny', scope: 'global', source: 'browser-use-persisted-state' }
    ])
      for (const action of ['accept', 'decline', 'cancel', 'invalid'])
        for (const persistent of [false, true]) {
          async function exercise(run: any) {
            const calls: any[] = [],
              result = { action },
              getter = () => async (input: any) => {
                calls.push(['prompt', input])
                return result
              },
              prefs = {
                getHistoryPermission: async (type: any) => {
                  calls.push(['history', type])
                  return saved
                },
                getFileTransferPermission: async (...args: any[]) => {
                  calls.push(['file', ...args])
                  return saved
                },
                getFullCdpPermission: async (origin: any) => {
                  calls.push(['cdp', origin])
                  return saved
                },
                isPersistentApprovalAllowed: async (origin: any) => {
                  calls.push(['persistent', origin])
                  return persistent
                },
                allowsGlobalPersistentApproval: async () => {
                  calls.push('global')
                  return persistent
                },
                handleHistoryPromptResult: async (...args: any[]) =>
                  calls.push(['save history', ...args]),
                handleFileTransferPromptResult: async (...args: any[]) =>
                  calls.push(['save file', ...args]),
                handleFullCdpPromptResult: async (...args: any[]) =>
                  calls.push(['save cdp', ...args])
              }
            let error
            try {
              await run(getter, ...fixture.args, prefs, { elicitationDisplayName: 'Browser' })
            } catch (e) {
              error = details(e)
            }
            return { calls, error }
          }
          expect(await exercise(fixture.candidate)).toEqual(await exercise(base[fixture.baseline]))
        }
  })
test('cross-origin asset gate bypasses same origin and invalid destination, matching original', async () => {
  const base = await originalDocumentation()
  for (const destination of ['https://example.com/other', 'invalid']) {
    await approveAssetOrigin(
      () => {
        throw Error('prompt')
      },
      'https://example.com/path',
      destination,
      {} as any
    )
    await base.baselineAssetOriginApproval(
      () => {
        throw Error('prompt')
      },
      'https://example.com/path',
      destination,
      {}
    )
  }
})
test('cross-origin asset bypass emits the original security audit event', async () => {
  const base = await originalDocumentation()
  const { setSecurityAudit } = await import('../../src/service-security-approval')
  async function exercise(run: any, set: any) {
    const events: any[] = []
    set((event: any) => events.push(event))
    try {
      await run(
        () => undefined,
        'https://example.com/path',
        'https://example.com/asset',
        {},
        { browserBackend: 'iab', browserFamily: 'chrome' }
      )
    } finally {
      set(undefined)
    }
    return events
  }
  expect(await exercise(approveAssetOrigin, setSecurityAudit)).toEqual(
    await exercise(base.baselineAssetOriginApproval, base.baselineSetAudit)
  )
})
test('origin approval preserves permission checks, automatic review metadata and saved-result calls', async () => {
  const base = await originalDocumentation()
  const { approveOrigin } = await import('../../src/service-approval-gates')
  for (const mode of ['v1', 'v2'])
    for (const action of ['accept', 'decline', 'cancel'])
      for (const disabled of [false, true]) {
        async function exercise(run: any) {
          const calls: any[] = [],
            context = {
              guardianMode: mode,
              preferenceSessionId: 'session',
              turn: { sessionId: 'session', turnId: 'turn' },
              guardianOrigin: undefined
            },
            prefs = {
              captureOriginRequestContext: (origin: any) => {
                calls.push(['context', origin])
                return context
              },
              getOriginPermission: async (...args: any[]) => {
                calls.push(['permission', ...args])
                return null
              },
              isAutoReviewDisabled: async () => {
                calls.push('auto')
                return disabled
              },
              isOriginAutoReviewDisabled: async () => {
                calls.push('origin auto')
                return false
              },
              isPersistentApprovalAllowed: async (origin: any) => {
                calls.push(['persistent', origin])
                return true
              },
              handleOriginPromptResult: async (...args: any[]) =>
                calls.push(['save origin', ...args])
            }
          let error
          try {
            await run(
              () => async (params: any) => {
                calls.push(['prompt', params])
                return { action }
              },
              'https://example.com',
              prefs,
              { elicitationDisplayName: 'Browser' }
            )
          } catch (e) {
            error = details(e)
          }
          return { calls, error }
        }
        expect(await exercise(approveOrigin)).toEqual(await exercise(base.baselineOriginApproval))
      }
})
test('WebMCP approval sanitizes page URL and validates arguments before requesting approval', async () => {
  const base = await originalDocumentation()
  const { approveWebMcp } = await import('../../src/service-approval-gates')
  for (const type of ['webmcp_list_tools', 'webmcp_invoke_tool'])
    for (const input of [{ value: 'data' }, null, NaN, 1n])
      for (const action of ['accept', 'decline']) {
        async function exercise(run: any) {
          const calls: any[] = [],
            request = {
              type,
              toolName: 'tool:name',
              toolTitle: 'Tool',
              toolDescription: 'Description',
              toolOrigin: 'https://tools.example.com/path',
              input
            }
          let value, error
          try {
            value = await run(
              () => async (params: any) => {
                calls.push(params)
                return { action }
              },
              'https://user:password@example.com/path?secret=1#hash',
              request,
              { elicitationDisplayName: 'Browser' }
            )
          } catch (e) {
            error = details(e)
          }
          return { value, error, calls }
        }
        expect(await exercise(approveWebMcp)).toEqual(await exercise(base.baselineWebMcpApproval))
      }
})
