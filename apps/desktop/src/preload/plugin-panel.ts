import { contextBridge, ipcRenderer } from 'electron'
// Each call is bound to its sending webContents. Pages never receive IPC or Node objects.
contextBridge.exposeInMainWorld('productPanel', Object.freeze({
  postMessage(type: string, payload: unknown): Promise<unknown> {
    return ipcRenderer.invoke('action-driver:plugin-panel:message', { type, payload })
  }
}))
