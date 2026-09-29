// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { browserResources } from '../../src/service-resources'

async function originalCheckpoint() {
  const source = await readFile(resolve(
    'packages/back/codex-cua/@oai/cua/dist/lib/js/oai_js_browser/dist/skill/scripts/browser-service.mjs'
  ), 'utf8')
  const classic = pathToFileURL(resolve('packages/browser-runtime/node_modules/classic-level/index.js')).href
  const module = await import('data:text/javascript;base64,' + Buffer.from(
    source.replace('../node_modules/classic-level.mjs', classic) +
    '\nexport {tk as originalCheckpoint,xy as originalResources};' +
    '\nexport function replaceOriginalAuthSnapshot(next){const previous=KR;KR=next;return ()=>KR=previous}'
  ).toString('base64'))
  return module as {
    originalCheckpoint(input: unknown): Promise<unknown>
    originalResources: { default: { documentation: Record<string, string> } }
    replaceOriginalAuthSnapshot(next: (...args: any[]) => Promise<string>): () => void
  }
}

function errorDetails(error: unknown) {
  const value = error as Error & { reason?: string; decisionSource?: string; retryable?: boolean }
  return {
    name: value.name,
    reason: value.reason,
    decisionSource: value.decisionSource,
    retryable: value.retryable,
    message: value.message,
    cause: (value.cause as Error | undefined)?.message
  }
}

test('copied browser service fails closed before reviewer, screenshot or credential prompt when safety document is absent', async () => {
  const { originalCheckpoint: original } = await originalCheckpoint()
  const candidate = await import('../../src/service-auth-safety-checkpoint').catch(() => ({} as any)) as any
  expect(typeof candidate.requireAuthSafetyInstructions).toBe('function')
  for (const environment of ['codex-app', 'training', 'cloud', 'orbit']) {
    const screenshot = vi.fn(), reviewer = vi.fn(), checkpoint = vi.fn()
    let expected: unknown, actual: unknown
    try {
      await original({
        ctx: { environment, clientInfo: { type: 'cdp' },
          elicitationDisplayName: 'Browser use', filesystem: {} },
        captureScreenshotAndValidateLocators: screenshot,
        createAutomatedSafetyPrecheck: reviewer,
        checkpoint
      })
    } catch (error) { expected = errorDetails(error) }
    try {
      await candidate.requireAuthSafetyInstructions({
        environment, browserBackend: 'cdp', elicitationDisplayName: 'Browser use'
      })
    } catch (error) { actual = errorDetails(error) }
    expect(actual).toEqual(expected)
    expect(screenshot).not.toHaveBeenCalled()
    expect(reviewer).not.toHaveBeenCalled()
    expect(checkpoint).not.toHaveBeenCalled()
  }
})

test('authenticated review checkpoint success and fail-closed branches match the copied service', async () => {
  const original = await originalCheckpoint()
  const current = await browserResources('codex-app')
  const name = 'browserAuthSafetyPrecheck'
  original.originalResources.default.documentation[name] = ' Review instructions. '
  current.documentation[name] = ' Review instructions. '
  const actionTargets = {
    options: [{ id: 'option-1', accessible_name: 'Use account', origin: 'https://example.com' }],
    submit: { action: 'click', accessible_name: 'Sign in' },
    submissionOrigin: 'https://example.com'
  }
  const params = { browser_id: 'browser-1', tab_id: '7', timeout_ms: 200 }
  const proposedUserPrompt = { origin: 'https://example.com', reason: 'Sign in' }
  const credentialFieldMetadata = [{ id: 'password', label: 'Password' }]
  type Scenario = 'success' | 'frame-missing' | 'snapshot-blank' | 'review-revalidate' |
    'review-rejected' | 'review-create-throws' | 'both-rejected' |
    'screenshot-rejected' | 'screenshot-status' | 'prompt-changed'
  const run = async (baseline: boolean, scenario: Scenario) => {
    const trace: string[] = []
    let reviewRequest: unknown
    const snapshot = async (_params: unknown, _ctx: unknown, frameId: string, captured: Set<string>) => {
      trace.push('visible-dom')
      if (scenario !== 'frame-missing') captured.add(frameId)
      return scenario === 'snapshot-blank' ? ' ' : 'Visible login form'
    }
    const stopOriginal = baseline ? original.replaceOriginalAuthSnapshot(snapshot) : () => {}
    const checkpoint = {
      revalidateForReview: async () => {
        trace.push('review-revalidate')
        return scenario === 'review-revalidate' ? 'origin_changed' : null
      },
      revalidate: async () => {
        trace.push('final-revalidate')
        return scenario === 'prompt-changed' ? 'prompt_changed' : null
      }
    }
    const createAutomatedSafetyPrecheck = (request: unknown) => {
      trace.push('review-start')
      reviewRequest = request
      if (scenario === 'review-create-throws') throw Error('review creation failed')
      return scenario === 'review-rejected' || scenario === 'both-rejected'
        ? Promise.reject(Error('review rejected'))
        : Promise.resolve({ action: 'accept' })
    }
    const captureScreenshotAndValidateLocators = async () => {
      trace.push('screenshot')
      if (scenario === 'screenshot-rejected' || scenario === 'both-rejected')
        throw Error('screenshot rejected')
      return scenario === 'screenshot-status' ? 'locator_invalid' : null
    }
    try {
      const shared = { actionTargets, checkpoint, credentialFieldMetadata,
        credentialFrameId: 'frame-1', credentialFrameOrigin: 'https://example.com',
        createAutomatedSafetyPrecheck, captureScreenshotAndValidateLocators,
        params, proposedUserPrompt }
      const result = baseline
        ? await original.originalCheckpoint({ ...shared,
          ctx: { environment: 'codex-app', clientInfo: { type: 'cdp' }, filesystem: {} } })
        : await (await import('../../src/service-auth-safety-checkpoint') as any).runAuthSafetyCheckpoint({
          ...shared, environment: 'codex-app', browserBackend: 'cdp',
          captureVisibleDom: (args: unknown, frameId: string, captured: Set<string>) =>
            snapshot(args, null, frameId, captured)
        })
      return { result, trace, reviewRequest }
    } catch (error) {
      return { error: errorDetails(error), trace, reviewRequest }
    } finally { stopOriginal() }
  }
  try {
    for (const scenario of [
      'success', 'frame-missing', 'snapshot-blank', 'review-revalidate',
      'review-rejected', 'review-create-throws', 'both-rejected',
      'screenshot-rejected', 'screenshot-status', 'prompt-changed'
    ] as const)
      expect(await run(false, scenario), scenario).toEqual(await run(true, scenario))
  } finally {
    delete current.documentation[name]
    delete original.originalResources.default.documentation[name]
  }
})

test('whitespace-only safety instructions fail closed with the copied error shape', async () => {
  const original = await originalCheckpoint()
  const current = await browserResources('codex-app')
  const name = 'browserAuthSafetyPrecheck'
  original.originalResources.default.documentation[name] = ' \n '
  current.documentation[name] = ' \n '
  try {
    const originalFailure = await original.originalCheckpoint({
      ctx: { environment: 'codex-app', clientInfo: { type: 'cdp' }, filesystem: {} }
    }).catch(errorDetails)
    const { requireAuthSafetyInstructions } = await import('../../src/service-auth-safety-checkpoint')
    const candidateFailure = await requireAuthSafetyInstructions({
      environment: 'codex-app', browserBackend: 'cdp'
    }).catch(errorDetails)
    expect(candidateFailure).toEqual(originalFailure)
    expect(candidateFailure).toMatchObject({
      reason: 'approval_unavailable',
      cause: 'Browser auth safety precheck instructions are empty.'
    })
  } finally {
    delete current.documentation[name]
    delete original.originalResources.default.documentation[name]
  }
})
