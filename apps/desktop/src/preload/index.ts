import { contextBridge, ipcRenderer } from 'electron'
import { createDesktopApi } from './desktop-api'

contextBridge.exposeInMainWorld(
  'actionDriverDesktop',
  createDesktopApi(process.platform, process.env.npm_package_version ?? '0.1.0', {
    invoke: (channel, input) => ipcRenderer.invoke(channel, input),
    on(channel, listener) {
      ipcRenderer.on(channel, listener)
    },
    off(channel, listener) {
      ipcRenderer.removeListener(channel, listener)
    }
  })
)
