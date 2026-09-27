import { contextBridge, ipcRenderer } from 'electron'
// Each call is bound to its sending webContents. Pages never receive IPC or Node objects.
contextBridge.exposeInMainWorld('actiondriverPanel', Object.freeze({
  postMessage(type: string, payload: unknown): Promise<unknown> {
    return ipcRenderer.invoke('actiondriver:plugin-panel:message', { type, payload })
  }
}))
