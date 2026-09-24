import type { RuntimeConnectionInfo } from '../../../shared/runtime-connection-contract'

export class RuntimeHttpClient {
  constructor(
    private readonly getConnection: () => Promise<RuntimeConnectionInfo>,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}
  ): Promise<T> {
    const connection = await this.getConnection()
    const url = new URL(connection.wsUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = path.split('?')[0] ?? path
    url.search = path.includes('?') ? `?${path.split('?').slice(1).join('?')}` : ''
    const response = await this.fetcher(url.toString(), {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${connection.accessToken}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(`Runtime returned an invalid response (${response.status})`)
    }
    if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
      throw new Error('Runtime returned an invalid response')
    }
    if (payload.ok === false && 'error' in payload) throw payload.error
    if (payload.ok !== true || !('value' in payload)) {
      throw new Error('Runtime returned an invalid response')
    }
    return payload.value as T
  }
}
