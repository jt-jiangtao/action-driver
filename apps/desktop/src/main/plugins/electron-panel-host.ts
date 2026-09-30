import { BrowserWindow, ipcMain, session } from 'electron'
import { realpath, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { z } from 'zod'
import { PluginError, type PluginOwner } from '@action-driver/plugin-contracts'
import { PluginPanelHost, type PanelHostPorts } from './panel-host'
const CHANNEL = 'action-driver:plugin-panel:message'
/** Containers this desktop host actually renders; any other declared container fails per view. */
export const SUPPORTED_VIEW_CONTAINERS = ['sidebar', 'window'] as const
export function createElectronPluginPanelHost(options: Omit<PanelHostPorts, 'create'> & { preload: string; packageRoot(owner: PluginOwner): string }) {
  const windows = new Map<number, { resourceId: string; owner: PluginOwner }>()
  const host = new PluginPanelHost({ ...options, supportedViewContainers: () => SUPPORTED_VIEW_CONTAINERS, create: async ({ owner, definition, resourceId, preferences }) => {
    let file: string | undefined
    if (definition.entry) {
      const root = await realpath(options.packageRoot(owner))
      file = await realpath(resolve(root, definition.entry))
      if (relative(root, file).startsWith('..') || !(await stat(file)).isFile()) throw new PluginError('INVALID_MANIFEST', 'Panel entry is outside package')
    }
    const partition = session.fromPartition(`action-driver-plugin-panel-${resourceId}`)
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(() => false)
    const window = new BrowserWindow({ title: definition.title ?? definition.id, show: false, width: 800, height: 600, webPreferences: { ...preferences, session: partition, preload: options.preload } })
    windows.set(window.webContents.id, { owner: { ...owner }, resourceId })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    const cleanup = () => { windows.delete(window.webContents.id); void host.close(owner, resourceId).catch(() => {}) }
    window.once('closed', cleanup)
    window.webContents.once('render-process-gone', () => { if (!window.isDestroyed()) window.destroy(); cleanup() })
    try {
      if (file) await window.loadFile(file); else await window.loadURL(definition.url!)
      window.show()
    } catch (error) { windows.delete(window.webContents.id); if (!window.isDestroyed()) window.destroy(); throw error }
    return { dispose: () => { windows.delete(window.webContents.id); if (!window.isDestroyed()) window.destroy() } }
  } })
  ipcMain.handle(CHANNEL, async (event, payload: unknown) => {
    const binding = windows.get(event.sender.id)
    if (!binding || event.senderFrame !== event.sender.mainFrame) throw new PluginError('AUTHORIZATION_DENIED', 'Panel sender is not owned')
    const input = z.object({ type: z.string(), payload: z.json() }).strict().parse(payload)
    return host.receive(binding.resourceId, binding.owner, input.type, input.payload)
  })
  return {
    host,
    dispose: async () => { ipcMain.removeHandler(CHANNEL); await host.dispose() }
  }
}
