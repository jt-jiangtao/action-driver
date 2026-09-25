import type { RuntimeConnectionInfo } from '../../../shared/runtime-connection-contract'
import type { ImageAssetRef } from '@actiondriver/contracts'

export class RuntimeHttpClient {
  constructor(
    private readonly getConnection: () => Promise<RuntimeConnectionInfo>,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {}

  async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}
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

  async uploadImage(file: File): Promise<Omit<ImageAssetRef, 'sessionId'>> {
    const connection = await this.getConnection()
    const response = await this.fetcher(this.httpUrl(connection, '/assets/staged'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.accessToken}`,
        'content-type': file.type || 'application/octet-stream'
      },
      body: file
    })
    const payload = (await response.json()) as
      | { ok: true; value: Omit<ImageAssetRef, 'sessionId'> }
      | { ok: false; error: { code: string; message: string } }
    if (!payload.ok) throw new Error(payload.error.message)
    return payload.value
  }

  async readImage(sessionId: string, assetId: string): Promise<Blob> {
    const connection = await this.getConnection()
    const response = await this.fetcher(
      this.httpUrl(
        connection,
        `/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(assetId)}`
      ),
      {
        headers: { authorization: `Bearer ${connection.accessToken}` }
      }
    )
    if (!response.ok) throw new Error(`IMAGE_READ_FAILED: ${response.status}`)
    return response.blob()
  }

  private httpUrl(connection: RuntimeConnectionInfo, path: string): string {
    const url = new URL(connection.wsUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = path
    url.search = ''
    return url.toString()
  }
}
