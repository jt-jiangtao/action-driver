import { z } from 'zod'
import { PluginError, type PluginOwner, type Json } from '@action-driver/plugin-contracts'
export function createPanelMessageClient(options: { connection(): { url: string; token: string }; fetch: typeof globalThis.fetch }) {
  return async (owner: PluginOwner, panelId: string, type: string, payload: Json): Promise<Json> => {
    const connection = options.connection()
    const response = await options.fetch(new URL('/plugins/panels/messages', connection.url), { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, panelId, type, payload }), signal: AbortSignal.timeout(7000) })
    const envelope = await response.json() as { ok?: boolean; value?: unknown; error?: unknown }
    if (!response.ok || envelope.ok !== true) throw PluginError.fromDTO(envelope.error ?? { code: 'UNAVAILABLE', message: 'Panel message request failed' })
    return z.json().parse(envelope.value)
  }
}
