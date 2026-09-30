import type { Hono } from 'hono'
import { z } from 'zod'
import type { PluginOwner, PluginUiContributions, Json } from '@action-driver/plugin-contracts'
import { success } from './http-contract'

export type PluginInterfaceRoutes = {
  message(owner: PluginOwner, panelId: string, type: string, payload: Json): Promise<Json>
  contributions(): PluginUiContributions
  openView(pluginId: string, viewId: string): Promise<{ resourceId: string }>
  executeCommand(pluginId: string, commandId: string, input: Json, request: { taskId?: string }): Promise<Json>
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

const commandExecuteSchema = z
  .object({
    pluginId: z.string().min(1),
    commandId: z.string().min(1),
    input: z.json().default(null),
    taskId: z.string().min(1).optional()
  })
  .strict()

const viewOpenSchema = z.object({ pluginId: z.string().min(1), viewId: z.string().min(1) }).strict()

export function registerPluginRoutes(app: Hono, options: PluginInterfaceRoutes): void {
  app.post('/plugins/panels/messages', async (context) => {
    const input = panelMessageSchema.parse(await context.req.json())
    return context.json(
      success(
        await options.message(input.owner, input.panelId, input.type, input.payload)
      )
    )
  })
  // Declared views and menus with the authoritative condition result; readable without activation.
  app.get('/plugins/contributions', async (context) => context.json(success(options.contributions())))
  // The owner is activated on demand and the surface is placed by the desktop container host.
  app.post('/plugins/views/open', async (context) => {
    const input = viewOpenSchema.parse(await context.req.json())
    return context.json(success(await options.openView(input.pluginId, input.viewId)))
  })
  // A menu entry is only a binding: the owner must be published and the shared condition is
  // re-evaluated here before the granted command runs.
  app.post('/plugins/commands/execute', async (context) => {
    const input = commandExecuteSchema.parse(await context.req.json())
    return context.json(success(await options.executeCommand(input.pluginId, input.commandId, input.input, input.taskId ? { taskId: input.taskId } : {})))
  })
}
