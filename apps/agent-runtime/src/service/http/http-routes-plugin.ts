import type { Hono } from 'hono'
import { z } from 'zod'
import type { PluginOwner, Json } from '@actiondriver/plugin-contracts'
import { success } from './http-contract'

export type PluginPanelRoutes = {
  message(owner: PluginOwner, panelId: string, type: string, payload: Json): Promise<Json>
}

const panelMessageSchema = z
  .object({
    owner: z
      .object({ pluginId: z.string().min(1), version: z.string().min(1), hostEpoch: z.string().min(1) })
      .strict(),
    panelId: z.string().min(1),
    type: z.string().min(1),
    payload: z.json()
  })
  .strict()

export function registerPluginRoutes(app: Hono, options: PluginPanelRoutes): void {
  app.post('/plugins/panels/messages', async (context) => {
    const input = panelMessageSchema.parse(await context.req.json())
    return context.json(
      success(
        await options.message(input.owner, input.panelId, input.type, input.payload)
      )
    )
  })
}
