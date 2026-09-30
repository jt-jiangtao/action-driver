import { z } from 'zod'
import { PluginError, type PluginUiContributions, type Json } from '@action-driver/plugin-contracts'

/**
 * Talks to the runtime plugin interface over the authenticated local service. The desktop never
 * decides availability itself: it renders what the runtime projects and re-checks on every action.
 */
export function createPluginContributionClient(options: { connection(): { url: string; token: string }; fetch: typeof globalThis.fetch }) {
  const request = async (path: string, init?: RequestInit): Promise<Json> => {
    const connection = options.connection()
    const response = await options.fetch(new URL(path, connection.url), {
      ...init,
      headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(7000)
    })
    const envelope = await response.json() as { ok?: boolean; value?: unknown; error?: unknown }
    if (!response.ok || envelope.ok !== true) throw PluginError.fromDTO(envelope.error ?? { code: 'UNAVAILABLE', message: `${path} failed` })
    return z.json().parse(envelope.value)
  }
  return {
    list: async (): Promise<PluginUiContributions> => await request('/plugins/contributions') as unknown as PluginUiContributions,
    openView: async (pluginId: string, viewId: string): Promise<void> => { await request('/plugins/views/open', { method: 'POST', body: JSON.stringify({ pluginId, viewId }) }) },
    executeCommand: async (pluginId: string, commandId: string, input: Json, taskId?: string): Promise<Json> =>
      await request('/plugins/commands/execute', { method: 'POST', body: JSON.stringify({ pluginId, commandId, input, ...(taskId ? { taskId } : {}) }) })
  }
}
