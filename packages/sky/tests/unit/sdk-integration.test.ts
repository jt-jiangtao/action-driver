// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createComputerUseTelemetry } from '../../src/mac/telemetry'
const require = createRequire(import.meta.url)

test('declared Statsig SDK and transitive core resolve at the pinned version', () => {
  const metadata = require('@statsig/js-client/package.json')
  const sdkRequire = createRequire(require.resolve('@statsig/js-client'))
  expect(metadata.version).toBe('3.32.6')
  expect(sdkRequire('@statsig/client-core/package.json').version).toBe('3.32.6')
  const sdk = require('@statsig/js-client')
  expect(typeof sdk.StatsigMetadataProvider.add).toBe('function')
  expect(typeof sdk.StatsigClient).toBe('function')
})
test('installed SDK offline client operations match the copied SDK without network traffic', async () => {
  const reference = await import(
    pathToFileURL(resolve('packages/back/codex-cua/@oai/cua/dist/_virtual/index.js'))
      .href
  )
  const installed = require('@statsig/js-client')
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('unexpected network')
  })
  async function exercise(sdk: any) {
    sdk.StatsigMetadataProvider.add({ candidate_test: 'offline' })
    const client = new sdk.StatsigClient(
      'client-offline-parity',
      { userID: 'initial' },
      {
        disableStorage: true,
        loggingEnabled: 'disabled',
        logLevel: sdk.LogLevel.None,
        networkConfig: { preventAllNetworkTraffic: true }
      }
    )
    try {
      await client.initializeAsync()
      client.updateUserSync({ userID: 'updated' })
      client.logEvent({ eventName: 'candidate-offline-smoke', value: 'value' })
      const context = client.getContext()
      return {
        userID: context.user.userID,
        initialized: client.loadingStatus,
        methods: ['initializeAsync', 'updateUserSync', 'logEvent'].map(
          (method) => typeof client[method]
        )
      }
    } finally {
      await client.shutdown()
    }
  }
  try {
    const expected = await exercise(reference.s)
    expect(await exercise(installed)).toEqual(expected)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
  }
})
test('default telemetry with an absent trusted host does not initialize SDK or fetch', () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('unexpected network')
  })
  const initialize = vi.spyOn(
    require('@statsig/js-client').StatsigClient.prototype,
    'initializeAsync'
  )
  try {
    const telemetry = createComputerUseTelemetry({ getHost: () => undefined })
    telemetry.clientCreated()
    expect(initialize).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
    initialize.mockRestore()
  }
})
