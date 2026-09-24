import type { ModelConnectionsDesktopApi } from '../../../preload/desktop-api'
import type { RuntimeHttpClient } from './runtime-http-client'

export class RuntimeModelHttpApi implements ModelConnectionsDesktopApi {
  constructor(private readonly http: RuntimeHttpClient) {}

  list() { return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['list']>>>(
    '/model-connections') }
  testConnection(draft: Parameters<ModelConnectionsDesktopApi['testConnection']>[0]) {
    return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['testConnection']>>>(
      '/model-connections/test', { method: 'POST', body: draft })
  }
  discover(draft: Parameters<ModelConnectionsDesktopApi['discover']>[0]) {
    return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['discover']>>>(
      '/model-connections/discover', { method: 'POST', body: draft })
  }
  refresh(connectionId: string) {
    return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['refresh']>>>(
      `/model-connections/${encodeURIComponent(connectionId)}/refresh`, { method: 'POST' })
  }
  testModels(draft: Parameters<ModelConnectionsDesktopApi['testModels']>[0], modelIds: string[]) {
    return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['testModels']>>>(
      '/model-connections/test-models', { method: 'POST', body: { draft, modelIds } })
  }
  testConnectionModels(connectionId: string, modelIds: string[]) {
    return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['testConnectionModels']>>>(
      `/model-connections/${encodeURIComponent(connectionId)}/test-models`,
      { method: 'POST', body: { modelIds } })
  }
  async setModelEnabled(connectionId: string, modelId: string, enabled: boolean): Promise<void> {
    await this.http.request(
      `/model-connections/${encodeURIComponent(connectionId)}/models/${encodeURIComponent(modelId)}`,
      { method: 'POST', body: { enabled } })
  }
  add(
    draft: Parameters<ModelConnectionsDesktopApi['add']>[0],
    models: Parameters<ModelConnectionsDesktopApi['add']>[1]
  ) {
    return this.http.request<Awaited<ReturnType<ModelConnectionsDesktopApi['add']>>>(
      '/model-connections', { method: 'POST', body: { draft, models } })
  }
  async delete(connectionId: string): Promise<void> {
    await this.http.request(`/model-connections/${encodeURIComponent(connectionId)}`,
      { method: 'DELETE' })
  }
}
