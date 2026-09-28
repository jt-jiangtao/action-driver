// @vitest-environment node
import { expect, test } from 'vitest'
import { runBrowserAuthChallenge } from '../src/service-auth-handler'

function challenge() {
  const events: string[] = []
  let resolveSubmission!: (value: any) => void
  const submitted = new Promise<any>((resolve) => { resolveSubmission = resolve })
  const broker = {
    id: 'a'.repeat(32), hasSubmission: false,
    waitForSubmission: async () => await submitted,
    complete: async (status: string) => { events.push(`complete:${status}`); return status },
    publishQrCodePayload: (payload: string, disappeared?: boolean) => { events.push(`qr:${payload}:${disappeared === true}`) },
    close: () => { events.push('close') }
  }
  return { broker, events, submit: (value: any) => { broker.hasSubmission = true; resolveSubmission(value) } }
}

const prompt = { origin: 'https://example.com', frame_origin: 'https://example.com', fields: [] }
test('broker registration precedes elicitation and accepted submission completes before close', async () => {
  const b = challenge()
  const result = await runBrowserAuthChallenge({
    prompt,
    fields: [{ id: 'password', required: true }],
    createChallenge: async (fields, options, metadata) => {
      expect(fields).toEqual([{ id: 'password', required: true }])
      expect(options).toBeUndefined()
      expect(metadata.origins).toEqual({ origin: prompt.origin, frame_origin: prompt.frame_origin })
      b.events.push('register')
      return b.broker
    },
    createElicitation: async (request) => {
      expect(request.meta.browser_auth_challenge_id).toBe(b.broker.id)
      b.events.push('elicit')
      b.submit({ fields: { password: 'secret' } })
      return { action: 'accept' }
    },
    submitCredentials: async () => { b.events.push('submit'); return 'submitted' }
  })
  expect(result).toEqual({ status: 'submitted' })
  expect(b.events).toEqual(['register', 'elicit', 'submit', 'complete:submitted', 'close'])
})

test('decline without submission completes broker and never exposes credential values', async () => {
  const b = challenge()
  const result = await runBrowserAuthChallenge({
    prompt, fields: [], createChallenge: async () => b.broker,
    createElicitation: async () => ({ action: 'decline' }),
    submitCredentials: async () => { throw Error('must not submit') }
  })
  expect(result).toEqual({ status: 'declined' })
  expect(b.events).toEqual(['complete:declined', 'close'])
})

test('invalid submitted values fail closed and complete unavailable without invoking fill', async () => {
  const b = challenge()
  const result = await runBrowserAuthChallenge({
    prompt, fields: [{ id: 'password', required: true }],
    createChallenge: async () => b.broker,
    createElicitation: async () => { b.submit({ fields: { password: '' } }); return { action: 'accept' } },
    submitCredentials: async () => { throw Error('must not submit') }
  })
  expect(result).toEqual({ status: 'unavailable' })
  expect(b.events).toEqual(['complete:unavailable', 'close'])
})

test('selected option cannot fill credentials belonging to another option', async () => {
  const b = challenge()
  let fillCalls = 0
  const result = await runBrowserAuthChallenge({
    prompt,
    fields: [{ id: 'username', required: true }, { id: 'password', required: true }],
    options: [
      { id: 'username-only', field_ids: ['username'] },
      { id: 'password-only', field_ids: ['password'] }
    ],
    createChallenge: async () => b.broker,
    createElicitation: async () => {
      b.submit({ fields: { username: 'alice', password: 'secret' }, selected_option: 'username-only' })
      return { action: 'accept' }
    },
    submitCredentials: async () => { fillCalls++; return 'submitted' }
  })
  expect(result).toEqual({ status: 'unavailable' })
  expect(fillCalls).toBe(0)
  expect(b.events).toEqual(['complete:unavailable', 'close'])
})

test('native delivery cannot fill credentials without an observation protection adapter', async () => {
  const b = challenge()
  let fillCalls = 0
  const result = await runBrowserAuthChallenge({
    prompt, fields: [{ id: 'password', required: true }],
    createChallenge: async () => b.broker,
    createElicitation: async () => {
      b.submit({ fields: { password: 'secret' }, native_credential_delivery: true })
      return { action: 'accept' }
    },
    submitCredentials: async () => { fillCalls++; return 'submitted' }
  })
  expect(result).toEqual({ status: 'unavailable' })
  expect(fillCalls).toBe(0)
  expect(b.events).toEqual(['complete:unavailable', 'close'])
})

test('QR-only mobile decline reports a secure HTTPS handoff link after closing broker', async () => {
  const b = challenge()
  await expect(runBrowserAuthChallenge({
    prompt, fields: [], qrCode: { payload: 'https://example.com/signin', bounds: { x: 0, y: 0, width: 10, height: 10 } },
    qrOnly: true, createChallenge: async () => b.broker,
    createElicitation: async () => ({ action: 'decline', _meta: { 'openai/client_is_mobile': true } }),
    submitCredentials: async () => 'submitted'
  })).rejects.toThrow('https://example.com/signin')
  expect(b.events.at(-1)).toBe('close')
})
