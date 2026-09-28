// @vitest-environment node
import { expect, test } from 'vitest'
import { prepareAuthCredentialDelivery } from '../src/service-auth-delivery'

function fixture() {
  const order: string[] = []
  const gate = {
    protect: async () => { order.push('native-protect') },
    protectManualSaving: async () => { order.push('manual-protect') }
  }
  const cdp = { protectBrowserAuthCredentialDiagnostics: () => { order.push('diagnostics-protect') } }
  return { gate, cdp, order }
}

test('native delivery protects observations before credentials can be submitted', async () => {
  const { gate, cdp, order } = fixture()
  const result = await prepareAuthCredentialDelivery({ native_credential_delivery: true }, {
    tabId: 7, credentialBinding: { submission: 'native' }, gate, cdp
  })
  expect(result).toEqual({ nativeDelivery: true, manualSave: false, ordinaryDelivery: false })
  expect(order).toEqual(['native-protect'])
})

test('manual saving protects tab and diagnostics before document access', async () => {
  const { gate, cdp, order } = fixture()
  const result = await prepareAuthCredentialDelivery({ manual_credential_save: true }, {
    tabId: 7, manualSave: { kind: 'private' }, hasFormBinding: true, gate, cdp
  })
  expect(result).toEqual({ nativeDelivery: false, manualSave: true, ordinaryDelivery: false })
  expect(order).toEqual(['manual-protect', 'diagnostics-protect'])
})

test('delivery modes fail closed when bindings or protection are absent', async () => {
  const { gate, cdp, order } = fixture()
  for (const options of [
    { native_credential_delivery: true, ordinary_credential_delivery: true },
    { manual_credential_save: true, ordinary_credential_delivery: true },
    { native_credential_delivery: true }
  ])
    await expect(prepareAuthCredentialDelivery(options, {
      tabId: 7, manualSave: { kind: 'ordinary' }, credentialBinding: { submission: 'ordinary' }, hasFormBinding: true, gate, cdp
    })).rejects.toThrow()
  await expect(prepareAuthCredentialDelivery({ manual_credential_save: true }, {
    tabId: 7, manualSave: { kind: 'private' }, hasFormBinding: true, cdp
  })).rejects.toThrow('protection is unavailable')
  expect(order).toEqual([])
})

test('credential protection releases the current model command before waiting for idle', async () => {
  const released: string[] = []
  const release = () => { released.push('released') }
  const gate = {
    protect: async (_tabId: number, finish?: () => void) => { finish?.() },
    protectManualSaving: async (_tabId: number, finish?: () => void) => { finish?.() }
  }
  const cdp = { protectBrowserAuthCredentialDiagnostics: () => {} }
  await prepareAuthCredentialDelivery({ native_credential_delivery: true }, {
    tabId: 7, credentialBinding: { submission: 'native' }, gate, cdp,
    releaseCommand: release
  })
  expect(released).toEqual(['released'])
})

test('original permits native and manual private flags together and installs both protections', async () => {
  const { gate, cdp, order } = fixture()
  const result = await prepareAuthCredentialDelivery({
    native_credential_delivery: true, manual_credential_save: true
  }, { tabId: 7, credentialBinding: { submission: 'native' },
    manualSave: { kind: 'private' }, hasFormBinding: true, gate, cdp })
  expect(result).toEqual({ nativeDelivery: true, manualSave: true, ordinaryDelivery: false })
  expect(order).toEqual(['manual-protect', 'diagnostics-protect', 'native-protect'])
})
