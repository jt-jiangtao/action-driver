import { NativeMessagePipe } from './service-native-pipe.js'
import type { NativeSocket } from './service-native-pipe.js'
interface BrokerTransport {
  sendMessage(value: Record<string, unknown>): unknown
  setMessageCallback(callback: (value: unknown) => unknown): unknown
  addCloseListener(callback: (error?: Error) => unknown): unknown
  close(error?: Error): unknown
}
interface BrokerHost {
  env: Record<string, string | undefined>
  nativePipe?: { createConnection(path: string): Promise<NativeSocket> }
}
interface PipeOptions {
  maxFrameBytes?: number
  singleResponse?: boolean
  closedBeforeResponseMessage?: string
  decodeMessage: (value: unknown) => any
}
type Connect = (path: string, options: PipeOptions, message: string) => Promise<BrokerTransport>
function connector(host: BrokerHost): Connect {
  return async (path, options, message) => {
    if (!host.nativePipe) throw Error(message)
    return new NativeMessagePipe(await host.nativePipe.createConnection(path), options)
  }
}
class Deferred<T> {
  promise: Promise<T>
  settled = false
  private resolveValue!: (value: T) => void
  private rejectValue!: (error: unknown) => void
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolveValue = resolve
      this.rejectValue = reject
    })
    void this.promise.catch(() => {})
  }
  resolve(value: T) {
    if (this.settled) return
    this.settled = true
    this.resolveValue(value)
  }
  reject(error: unknown) {
    if (this.settled) return
    this.settled = true
    this.rejectValue(error)
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)
const statuses = new Set([
  'submitted',
  'declined',
  'cancelled',
  'unavailable',
  'expired',
  'origin_changed',
  'page_changed',
  'locator_invalid',
  'submission_failed'
])
interface Submission {
  fields: Record<string, string>
  native_credential_delivery: true | undefined
  ordinary_credential_delivery: true | undefined
  manual_credential_save: true | undefined
  selected_option?: string
}
export class AuthBrokerChallenge {
  registered = new Deferred<string>()
  submission = new Deferred<Submission | { status: string }>()
  completed = new Deferred<string>()
  challengeId: string | null = null
  submissionReceived = false
  resultSent = false
  closed = false
  constructor(public transport: BrokerTransport) {
    transport.setMessageCallback((message) => this.handleMessage(message))
    transport.addCloseListener((error) =>
      this.fail(error ?? Error('browser auth broker closed unexpectedly'))
    )
  }
  static async create(
    host: BrokerHost,
    fields: unknown,
    options?: unknown,
    metadata?: {
      qrCode?: boolean
      origins?: unknown
      manualSaveFields?: unknown
      manualSaveSessionId?: unknown
      credentialBinding?: unknown
    },
    connect: Connect = connector(host)
  ) {
    const path = host.env.BROWSER_AUTH_BROKER_SOCKET_PATH?.trim()
    if (!path) throw Error('browser auth broker is unavailable')
    const transport = await connect(
        path,
        {
          closedBeforeResponseMessage: 'browser auth broker closed unexpectedly',
          decodeMessage: (value) => value,
          maxFrameBytes: 128 * 1024
        },
        'browser auth broker is unavailable'
      ),
      challenge = new AuthBrokerChallenge(transport)
    challenge.send({
      type: 'register',
      fields,
      ...(options == null ? {} : { options }),
      ...(metadata?.qrCode === true ? { qr_code: true } : {}),
      origins: metadata?.origins,
      manual_save_fields: metadata?.manualSaveFields,
      manual_save_session_id: metadata?.manualSaveSessionId,
      credential_binding: metadata?.credentialBinding
    })
    await challenge.registered.promise
    return challenge
  }
  get id() {
    if (this.challengeId == null) throw Error('browser auth challenge is not registered')
    return this.challengeId
  }
  get hasSubmission() {
    return this.submissionReceived
  }
  async waitForSubmission() {
    return await this.submission.promise
  }
  async complete(status: string) {
    if (!this.resultSent) {
      this.resultSent = true
      this.send({ type: 'result', challenge_id: this.id, status })
    }
    return await this.completed.promise
  }
  publishQrCodePayload(payload: string, disappeared?: boolean) {
    if (payload.length === 0) throw Error('invalid browser auth QR code payload')
    this.send({
      type: 'qr_code_snapshot',
      challenge_id: this.id,
      payload,
      ...(disappeared === true ? { disappeared: true } : {})
    })
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.transport.close()
  }
  send(message: Record<string, unknown>) {
    if (this.closed) throw Error('browser auth broker is closed')
    this.transport.sendMessage(message)
  }
  handleMessage(message: unknown) {
    if (!record(message) || typeof message.type !== 'string')
      throw Error('invalid browser auth broker message')
    if (message.type === 'registered') {
      if (
        typeof message.challenge_id !== 'string' ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(message.challenge_id)
      )
        throw Error('invalid browser auth challenge id')
      this.challengeId = message.challenge_id
      this.registered.resolve(message.challenge_id)
      return
    }
    if (message.type === 'submission') {
      if (message.challenge_id !== this.id) throw Error('browser auth challenge id mismatch')
      if (this.resultSent) return
      if (
        !record(message.fields) ||
        Object.values(message.fields).some((value) => typeof value !== 'string')
      )
        throw Error('invalid browser auth submission')
      const fields = Object.assign(Object.create(null), message.fields) as Record<string, string>,
        option = message.selected_option,
        native = message.native_credential_delivery,
        ordinary = message.ordinary_credential_delivery,
        manual = message.manual_credential_save
      if (
        option !== undefined &&
        (typeof option !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(option))
      )
        throw Error('invalid browser auth submission')
      if (native !== undefined && native !== true) throw Error('invalid native credential delivery')
      if ((ordinary !== undefined && ordinary !== true) || (ordinary === true && native === true))
        throw Error('invalid ordinary credential delivery')
      if (manual !== undefined && manual !== true) throw Error('invalid manual credential saving')
      this.submissionReceived = true
      this.submission.resolve({
        fields,
        native_credential_delivery: native,
        ordinary_credential_delivery: ordinary,
        manual_credential_save: manual,
        ...(option === undefined ? {} : { selected_option: option as string })
      })
      return
    }
    if (message.type === 'completed') {
      if (
        message.challenge_id !== this.id ||
        typeof message.status !== 'string' ||
        !statuses.has(message.status)
      )
        throw Error('invalid browser auth completion')
      this.completed.resolve(message.status)
      this.submission.resolve({ status: message.status })
      return
    }
    throw Error('browser auth broker rejected the request')
  }
  fail(error: Error) {
    if (this.closed) return
    this.closed = true
    this.registered.reject(error)
    this.submission.reject(error)
    this.completed.reject(error)
    this.transport.close(error)
  }
}
export async function readNativeCredentialStatus(
  host: BrokerHost,
  session: string,
  connect: Connect = connector(host)
) {
  const path = host.env.BROWSER_AUTH_BROKER_SOCKET_PATH?.trim(),
    unavailable = () => Error('Native credential state is unavailable')
  if (!path || !session || session.length > 256) throw unavailable()
  const transport = await connect(
    path,
    { decodeMessage: (value) => value, maxFrameBytes: 1024, singleResponse: true },
    'Native credential state is unavailable'
  )
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false
    const finish = (value?: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        transport.close()
        if (value === undefined) reject(unavailable())
        else resolve(value)
      },
      timer = setTimeout(() => finish(), 3000)
    transport.addCloseListener(() => finish())
    transport.setMessageCallback((message) => {
      if (settled) return
      if (
        !record(message) ||
        Object.keys(message).length !== 2 ||
        message.type !== 'native_observation_status' ||
        typeof message.used !== 'boolean'
      ) {
        finish()
        return
      }
      finish(message.used)
    })
    try {
      transport.sendMessage({ type: 'native_observation_status', session_id: session })
    } catch {
      finish()
    }
  })
}
