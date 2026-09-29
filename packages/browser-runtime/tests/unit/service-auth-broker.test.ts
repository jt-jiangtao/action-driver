// @vitest-environment node
import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { FrameDecoder, encodeFrame } from '../../src/service-native-pipe'
import { AuthBrokerChallenge, readNativeCredentialStatus } from '../../src/service-auth-broker'
import { originalDocumentation } from '../original-service'
function transport() {
  const sent: any[] = [],
    closed: any[] = []
  let message: any, close: any
  return {
    sent,
    closed,
    pipe: {
      sendMessage: (value: any) => sent.push(value),
      setMessageCallback: (callback: any) => {
        message = callback
      },
      addCloseListener: (callback: any) => {
        close = callback
      },
      close: (error?: any) => closed.push(error?.message)
    },
    message: (value: any) => message(value),
    fail: () => close(Error('closed'))
  }
}
test('broker challenge tracks registration, verified submission, QR messages and idempotent completion', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = transport(),
      challenge = new Type(f.pipe)
    let unregistered
    try {
      void challenge.id
    } catch (e: any) {
      unregistered = e.message
    }
    const id = 'a'.repeat(32)
    f.message({ type: 'registered', challenge_id: id })
    await challenge.registered.promise
    challenge.publishQrCodePayload('https://example.com')
    f.message({
      type: 'submission',
      challenge_id: id,
      fields: { password: 'secret' },
      selected_option: 'option',
      native_credential_delivery: true
    })
    const submission = await challenge.waitForSubmission(),
      complete = challenge.complete('submitted')
    f.message({ type: 'completed', challenge_id: id, status: 'submitted' })
    const status = await complete
    await challenge.complete('submitted')
    challenge.close()
    challenge.close()
    return {
      unregistered,
      submission,
      status,
      hasSubmission: challenge.hasSubmission,
      sent: f.sent,
      closed: f.closed
    }
  }
  expect(await exercise(AuthBrokerChallenge)).toEqual(
    await exercise(base.baselineBrokerTools(() => {}).Challenge)
  )
})
test('broker messages reject malformed identifiers, contradictory deliveries and non-string fields', async () => {
  const base = await originalDocumentation()
  async function exercise(Type: any) {
    const f = transport(),
      challenge = new Type(f.pipe),
      id = 'b'.repeat(32),
      errors: string[] = []
    for (const value of [null, { type: 'registered', challenge_id: 'short' }, { type: 'unknown' }])
      try {
        f.message(value)
      } catch (e: any) {
        errors.push(e.message)
      }
    f.message({ type: 'registered', challenge_id: id })
    for (const value of [
      { type: 'submission', challenge_id: 'other', fields: {} },
      { type: 'submission', challenge_id: id, fields: { value: 1 } },
      {
        type: 'submission',
        challenge_id: id,
        fields: {},
        native_credential_delivery: true,
        ordinary_credential_delivery: true
      },
      { type: 'completed', challenge_id: id, status: 'invalid' }
    ])
      try {
        f.message(value)
      } catch (e: any) {
        errors.push(e.message)
      }
    const pending = challenge.waitForSubmission().catch((e: any) => e.message)
    f.fail()
    return { errors, error: await pending, closed: f.closed }
  }
  expect(await exercise(AuthBrokerChallenge)).toEqual(
    await exercise(base.baselineBrokerTools(() => {}).Challenge)
  )
})
test('native credential status accepts only exact response shape and always closes transport', async () => {
  const base = await originalDocumentation()
  for (const response of [
    { type: 'native_observation_status', used: false },
    { type: 'native_observation_status', used: true },
    { type: 'native_observation_status', used: false, extra: true },
    {}
  ]) {
    async function exercise(original: boolean) {
      const f = transport(),
        connect = async () => {
          const send = f.pipe.sendMessage
          f.pipe.sendMessage = (value: any) => {
            send(value)
            queueMicrotask(() => f.message(response))
          }
          return f.pipe
        },
        host = { env: { BROWSER_AUTH_BROKER_SOCKET_PATH: '/tmp/broker' } }
      let value, error
      try {
        value = await (
          original ? base.baselineBrokerTools(connect).status : readNativeCredentialStatus
        )(host, 'session', connect)
      } catch (e: any) {
        error = e.message
      }
      return { value, error, sent: f.sent, closed: f.closed }
    }
    expect(await exercise(false)).toEqual(await exercise(true))
  }
})
test('challenge creation preserves registration metadata and configures frame limit at native boundary', async () => {
  const base = await originalDocumentation()
  async function exercise(original: boolean) {
    const f = transport(),
      calls: any[] = [],
      connect = async (path: string, options: any, message: string) => {
        calls.push([path, { ...options, decodeMessage: 'decode' }, message])
        const send = f.pipe.sendMessage
        f.pipe.sendMessage = (value: any) => {
          send(value)
          queueMicrotask(() => f.message({ type: 'registered', challenge_id: 'c'.repeat(32) }))
        }
        return f.pipe
      },
      host = { env: { BROWSER_AUTH_BROKER_SOCKET_PATH: ' /tmp/broker ' } }
    const metadata = {
        qrCode: true,
        origins: ['https://example.com'],
        manualSaveFields: ['password'],
        manualSaveSessionId: 'session',
        credentialBinding: { tabId: 1 }
      },
      Type = original ? base.baselineBrokerTools(connect).Challenge : AuthBrokerChallenge,
      challenge = await Type.create(host, { password: 'label' }, ['choice'], metadata, connect)
    challenge.close()
    return { calls, id: challenge.id, sent: f.sent, closed: f.closed }
  }
  expect(await exercise(false)).toEqual(await exercise(true))
})

test('native status default connector executes framed status request and closes exact-response socket', async () => {
  let closed = 0
  const decoder = new FrameDecoder(),
    requests: any[] = [],
    socket = Object.assign(new EventEmitter(), {
      write: (frame: Buffer) => {
        for (const text of decoder.push(frame)) {
          requests.push(JSON.parse(text))
          queueMicrotask(() => {
            socket.emit(
              'data',
              encodeFrame(JSON.stringify({ type: 'native_observation_status', used: false }))
            )
            socket.emit('close')
          })
        }
      },
      end: () => {
        closed++
      }
    })
  expect(
    await readNativeCredentialStatus(
      {
        env: { BROWSER_AUTH_BROKER_SOCKET_PATH: '/tmp/broker' },
        nativePipe: { createConnection: async () => socket }
      },
      'session'
    )
  ).toBe(false)
  expect(requests).toEqual([{ type: 'native_observation_status', session_id: 'session' }])
  await new Promise((resolve) => setImmediate(resolve))
  expect(closed).toBe(1)
})
