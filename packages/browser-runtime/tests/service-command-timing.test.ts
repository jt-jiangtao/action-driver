// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { CommandTiming } from '../src/service-command-timing'
import { originalDocumentation } from './original-service'
test('command duration excludes elicitation and locator retry outcomes are counted once', async () => {
  const base = await originalDocumentation()
  let clock = 0
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock)
  try {
    async function exercise(timing: any) {
      clock = 0
      const events: any[] = []
      const command = timing.startCommand('command', (...args: any[]) => events.push(args))
      await command.run(async () => {
        clock = 10
        const retry = timing.startLocatorRetry()
        retry.attemptFailed()
        retry.attemptFailed()
        clock = 20
        retry.finish('success')
        retry.finish('timeout')
        const prompt = timing.trackElicitation(async () => {
          clock += 20
          return 'approved'
        })
        expect(await prompt({})).toBe('approved')
        clock = 70
      })
      command.finish('ok')
      return events
    }
    expect(await exercise(new CommandTiming())).toEqual(await exercise(base.baselineCommandTiming))
  } finally {
    spy.mockRestore()
  }
})
test('timing outside commands is harmless and rejected approvals still deduct their elapsed duration', async () => {
  const base = await originalDocumentation(),
    spy = vi.spyOn(performance, 'now')
  try {
    async function exercise(timing: any) {
      let clock = 0
      spy.mockImplementation(() => clock)
      const retry = timing.startLocatorRetry()
      retry.attemptFailed()
      retry.finish('timeout')
      const events: any[] = []
      const command = timing.startCommand('command', (...args: any[]) => events.push(args))
      await command.run(async () => {
        const prompt = timing.trackElicitation(async () => {
          clock = 50
          throw Error('denied')
        })
        await expect(prompt({})).rejects.toThrow('denied')
        clock = 80
      })
      command.finish('error')
      return events
    }
    expect(await exercise(new CommandTiming())).toEqual(await exercise(base.baselineCommandTiming))
  } finally {
    spy.mockRestore()
  }
})
