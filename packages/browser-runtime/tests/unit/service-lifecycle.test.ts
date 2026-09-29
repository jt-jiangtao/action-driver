// @vitest-environment node
import { expect, test } from 'vitest'
import * as candidate from '../../src/service-lifecycle'
import { originalService } from '../original-service'
async function compare(run: (make: any) => Promise<unknown>) {
  const expected = await run((prepareHost: any, createRuntime: any) =>
    originalService(prepareHost, createRuntime)
  )
  expect(
    await run((prepareHost: any, createRuntime: any) =>
      (candidate as any).createBrowserService({ prepareHost, createRuntime })
    )
  ).toEqual(expected)
}
function runtime(id: string, calls: any[]) {
  return {
    apiManifest: { interfaces: {} },
    disabledMemberIds: new Set([`Member.${id}`]),
    async executeAgentCommand(input: any) {
      calls.push({ id, input })
      return { id }
    }
  }
}
async function error(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (e) {
    return (e as Error).message
  }
}
test('service lifecycle rejects execute before setup and dispatches only own supported methods', async () => {
  await compare(async (make) => {
    const handler = await make(
      async () => ({}),
      () => runtime('one', [])
    )
    const errors = []
    for (const method of ['execute', 'unknown', 'toString', 'constructor', '__proto__'])
      errors.push(await error(() => handler({ method, params: {} })))
    return errors
  })
})
test('service lifecycle accepts original environments and forwards setup fields/host identity', async () => {
  await compare(async (make) => {
    const calls: any[] = [],
      host = {}
    const handler = await make(
      async () => host,
      (options: any, given: any) => {
        calls.push({ options, same: host === given })
        return runtime(options.environment, calls)
      }
    )
    const results = []
    for (const environment of ['codex-app', 'training', 'cloud', 'orbit']) {
      results.push(
        await handler({
          method: 'setup',
          params: {
            environment,
            undocumentedApiMembers: ['x'],
            excludedDocumentation: ['y'],
            unrelated: 1
          }
        })
      )
      results.push(await handler({ method: 'execute', params: { command: environment } }))
    }
    return { results, calls }
  })
})
test('invalid setup environment retains the previously initialized runtime', async () => {
  await compare(async (make) => {
    const calls: any[] = []
    const handler = await make(
      async () => ({}),
      () => runtime('existing', calls)
    )
    await handler({ method: 'setup', params: { environment: 'codex-app' } })
    const errors = []
    for (const environment of [undefined, null, '', 'custom'])
      errors.push(await error(() => handler({ method: 'setup', params: { environment } })))
    return { errors, result: await handler({ method: 'execute', params: 'command' }), calls }
  })
})
test('failed runtime assembly remains failed for subsequent execution until another setup', async () => {
  await compare(async (make) => {
    let failed = true
    const handler = await make(
      async () => ({}),
      () => {
        if (failed) throw new Error('assembly failed')
        return runtime('recovered', [])
      }
    )
    const setupError = await error(() =>
      handler({ method: 'setup', params: { environment: 'codex-app' } })
    )
    const executionError = await error(() => handler({ method: 'execute', params: {} }))
    failed = false
    await handler({ method: 'setup', params: { environment: 'training' } })
    return { setupError, executionError, result: await handler({ method: 'execute', params: {} }) }
  })
})
test('execution waits for pending setup and keeps its captured runtime across a later setup', async () => {
  await compare(async (make) => {
    const calls: any[] = [],
      resolvers: ((value: string) => void)[] = []
    const handler = await make(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        }),
      (_options: any, id: string) => runtime(id, calls)
    )
    const firstSetup = handler({ method: 'setup', params: { environment: 'codex-app' } })
    const firstExecution = handler({ method: 'execute', params: 'first' })
    const secondSetup = handler({ method: 'setup', params: { environment: 'training' } })
    resolvers[1]!('second')
    await secondSetup
    const secondExecution = await handler({ method: 'execute', params: 'second' })
    resolvers[0]!('first')
    return {
      firstSetup: await firstSetup,
      firstExecution: await firstExecution,
      secondExecution,
      calls
    }
  })
})
test('unsupported service request does not read its params accessor', async () => {
  await compare(async (make) => {
    const handler = await make(
      async () => ({}),
      () => runtime('one', [])
    )
    return await error(() =>
      handler({
        method: 'missing',
        get params() {
          throw new Error('params read')
        }
      })
    )
  })
})
