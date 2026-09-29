// @vitest-environment node
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { PluginError } from '@actiondriver/plugin-contracts'
import { mapErrorToResponse } from '../../../src/service/http/http-errors'
import { failure } from '../../../src/service/http/http-contract'
import { registerPluginRoutes } from '../../../src/service/http/http-routes-plugin'

const owner = { pluginId: 'ui', version: '1.0.0', hostEpoch: 'epoch' }

function app() {
  const instance = new Hono()
  registerPluginRoutes(instance, {
    message: async () => null,
    contributions: () => ({
      views: [{ pluginId: 'ui', version: '1.0.0', definition: { id: 'ui.dashboard', title: 'Dashboard', container: 'sidebar', entry: 'view.html', messages: {} }, available: true }],
      menus: [{ pluginId: 'ui', version: '1.0.0', definition: { id: 'ui.refresh-menu', title: '刷新', command: 'ui.refresh', location: 'plugins-menu' }, available: false }]
    }),
    executeCommand: async (pluginId, commandId, input, request) => {
      if (commandId === 'ui.blocked') throw new PluginError('UNAVAILABLE', `${commandId}: context condition is false`)
      return { pluginId, commandId, input, taskId: request.taskId ?? null }
    },
    openView: async (pluginId, viewId) => {
      if (viewId === 'ui.gated') throw new PluginError('UNAVAILABLE', `${viewId}: context condition is false`)
      return { resourceId: `${pluginId}-${viewId}` }
    }
  })
  instance.onError((error, context) => {
    const mapped = mapErrorToResponse(error)
    return context.json(failure(mapped.code, mapped.message), mapped.status)
  })
  return instance
}

describe('plugin interface routes', () => {
  it('lists the declared views and menus with their authoritative availability', async () => {
    const response = await app().request('/plugins/contributions')
    const body = await response.json() as { ok: boolean; value: { views: { definition: { container: string } }[]; menus: { available: boolean }[] } }
    expect(response.status).toBe(200)
    expect(body.value.views[0]?.definition.container).toBe('sidebar')
    expect(body.value.menus[0]?.available).toBe(false)
  })

  it('executes a declared command with the caller task and surfaces the authoritative refusal', async () => {
    const accepted = await app().request('/plugins/commands/execute', { method: 'POST', body: JSON.stringify({ pluginId: 'ui', commandId: 'ui.refresh', input: { count: 2 }, taskId: 'task-1' }) })
    expect(await accepted.json()).toEqual({ ok: true, value: { pluginId: 'ui', commandId: 'ui.refresh', input: { count: 2 }, taskId: 'task-1' } })
    const refused = await app().request('/plugins/commands/execute', { method: 'POST', body: JSON.stringify({ pluginId: 'ui', commandId: 'ui.blocked', input: {}, taskId: 'task-1' }) })
    const body = await refused.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAVAILABLE')
  })

  it('rejects panel messages from an unknown owner shape before reaching the host', async () => {
    const response = await app().request('/plugins/panels/messages', { method: 'POST', body: JSON.stringify({ owner: { pluginId: 'ui' }, panelId: 'p', type: 't', payload: {} }) })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(owner.pluginId).toBe('ui')
  })

  it('opens a view through the runtime and reports a host refusal without creating a surface', async () => {
    const opened = await app().request('/plugins/views/open', { method: 'POST', body: JSON.stringify({ pluginId: 'ui', viewId: 'ui.dashboard' }) })
    expect(await opened.json()).toEqual({ ok: true, value: { resourceId: 'ui-ui.dashboard' } })
    const refused = await app().request('/plugins/views/open', { method: 'POST', body: JSON.stringify({ pluginId: 'ui', viewId: 'ui.gated' }) })
    const body = await refused.json() as { ok: boolean; error: { code: string; message: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('UNAVAILABLE')
    expect(body.error.message).toContain('context condition')
  })
})
