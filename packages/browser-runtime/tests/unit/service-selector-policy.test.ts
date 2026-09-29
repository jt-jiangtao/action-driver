// @vitest-environment node
import { test, expect, vi } from 'vitest'
import * as policy from '../../src/service-selector-policy'
import { CommandTiming } from '../../src/service-command-timing'
import { originalDocumentation } from '../original-service'
test('selector deadlines, target keys and error decoding match original', async () => {
  const base = await originalDocumentation(),
    pairs = [
      [policy.withSelectorDeadline, base.baselineWithSelectorDeadline],
      [policy.selectorBudget, base.baselineSelectorBudget],
      [policy.selectorRetryDelay, base.baselineSelectorRetryDelay]
    ]
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  try {
    for (const options of [
      {},
      { deadlineMs: 1005 },
      { deadlineMs: 999 },
      { deadlineMs: 3000, timeoutMs: 20 }
    ])
      for (const [a, b] of pairs) {
        let actual, expected
        try {
          actual = a(options, 1000, 20)
        } catch (e: any) {
          actual = e.message
        }
        try {
          expected = b(options, 1000, 20)
        } catch (e: any) {
          expected = e.message
        }
        expect(actual).toEqual(expected)
      }
    for (const target of [
      { tabId: 1 },
      { tabId: 1, sessionId: 'session' },
      { tabId: 1, targetId: 'target' },
      { tabId: 1, sessionId: 's', targetId: 't' }
    ]) {
      expect(policy.selectorTargetKey(target, 'frame')).toEqual(
        base.baselineSelectorTargetKey(target, 'frame')
      )
      expect(policy.selectorTargetKeys(target)).toEqual(base.baselineSelectorTargetKeys(target))
    }
    for (const result of [
      { result: { value: false } },
      {
        exceptionDetails: {
          exception: { description: 'description', value: 'value' },
          text: 'text'
        }
      },
      { exceptionDetails: { text: 'text' } },
      { exceptionDetails: { exception: { value: 42 } } }
    ]) {
      const invoke = (fn: any) => {
        try {
          return { value: fn(result) }
        } catch (e: any) {
          return { error: e.message }
        }
      }
      expect(invoke(policy.selectorResult)).toEqual(invoke(base.baselineSelectorResult))
    }
    for (const error of [
      'strict mode violation: ambiguous',
      'Playwright injected helper is missing',
      'Browser Use Playwright injected helper is missing',
      "Cannot read properties of undefined (reading 'incrementalAriaSnapshot')",
      'incrementalAriaSnapshot is not a function'
    ]) {
      expect(policy.isStrictSelectorError(Error(error))).toBe(
        base.baselineSelectorStrict(Error(error))
      )
      expect(policy.isMissingInjectedError(Error(error))).toBe(
        base.baselineMissingInjected(Error(error))
      )
    }
  } finally {
    vi.useRealTimers()
  }
})
test('selector retries preserve success/timeout accounting and strict errors bypass retry', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean, mode: string) {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const timing = original ? base.baselineCommandTiming : new CommandTiming(),
      events: any[] = []
    let attempts = 0
    const command = timing.startCommand('locator', (...args: any[]) => events.push(args)),
      error = mode === 'strict' ? 'strict mode violation: ambiguous' : 'Element missing'
    const resultPromise = command.run(async () => {
      try {
        return {
          value: await (original ? base.baselineRetrySelector : policy.retrySelector)(
            'button',
            async () => {
              attempts++
              if (mode === 'success' && attempts === 2) return 'found'
              throw Error(error)
            },
            {
              startedAt: 1000,
              timeoutMs: 150,
              deadlineMs: 1150,
              ...(mode === 'single' ? { retry: false } : {})
            },
            timing
          )
        }
      } catch (e: any) {
        return { error: e.message }
      } finally {
        command.finish('done')
      }
    })
    await vi.runAllTimersAsync()
    const result = await resultPromise
    vi.useRealTimers()
    return { result, attempts, events }
  }
  for (const mode of ['success', 'timeout', 'strict', 'single'])
    expect(await exercise(false, mode)).toEqual(await exercise(true, mode))
})
test('selector frame routes and small helpers retain exact original outputs',async()=>{
 const base=await originalDocumentation(),tree={frame:{id:'main'},childFrames:[{frame:{id:'child'},childFrames:[{frame:{id:'grandchild'}}]}]}
 expect(policy.selectorFrames(tree)).toEqual(base.baselineSelectorFrames(tree))
 const selector='iframe >> internal:control=enter-frame >> button'
 for(const count of[0,1,2,-1])expect(policy.remainingSelector(selector,count)).toBe(base.baselineRemainingSelector(selector,count))
 for(const key of['1','1:frame','11:frame'])expect(policy.selectorKeyMatches(key,'1')).toBe(base.baselineSelectorKeyMatches(key,'1'))
 for(const name of['id','name','missing'])expect(policy.selectorNodeAttribute(['id','node','name','value'],name)).toBe(base.baselineSelectorNodeAttribute(['id','node','name','value'],name))
 for(const url of[undefined,null,'about:blank','data:text/plain,test','https://example.com','bad'])expect(policy.isBlankSelectorFrame(url)).toBe(base.baselineBlankFrame(url))
 expect(policy.selectorTelemetry({operation:'locator',phase:'resolve'})).toEqual(base.baselineSelectorTelemetry({operation:'locator',phase:'resolve'}))
 for(const attrs of[undefined,{}, {'browser_use.playwright.operation':'locator'}, {'browser_use.playwright.operation':42}])expect(policy.selectorOperation(attrs)).toBe(base.baselineSelectorOperation(attrs))
})
