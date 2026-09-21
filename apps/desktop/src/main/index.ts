import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MainServices } from './container'
import { createMainContainer, resolveMainServices } from './container'
import { applyApplicationName, applyDockIcon, resolveDesktopIconPath } from './app-identity'
import { registerAgentIpcHandlers } from './agent-ipc'
import { createLocalRuntimeServices } from './local-runtime'
import { installNavigationGuards } from './navigation-security'
import { resolveRuntimePaths } from './runtime-paths'
import { createMockSkillProviderHost } from './skill-provider-host'
import { resolveDesktopCompositionMode } from '../shared/composition-mode'

const desktopIconPath = resolveDesktopIconPath(__dirname)
const compositionMode = resolveDesktopCompositionMode(import.meta.env.MODE)
let services: MainServices
let quitting = false

applyApplicationName(app)

function createWindow(mainServices: MainServices): BrowserWindow {
  const rendererPath = join(__dirname, '../renderer/index.html')
  const rendererEntryUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  const window = new BrowserWindow(
    mainServices.windowOptionsFactory(join(__dirname, '../preload/index.mjs'), desktopIconPath)
  )

  installNavigationGuards(window.webContents, rendererEntryUrl)
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(rendererEntryUrl)
  } else {
    void window.loadFile(rendererPath)
  }
  return window
}

app.whenReady().then(async () => {
  applyDockIcon(app, desktopIconPath)
  if (compositionMode === 'mock') {
    services = resolveMainServices(createMainContainer({ mode: 'mock' }))
  } else {
    const skillProviderHost = createMockSkillProviderHost()
    const paths = resolveRuntimePaths({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      platform: process.platform,
      arch: process.arch
    })
    const runtime = createLocalRuntimeServices(paths, app.getVersion(), skillProviderHost)
    services = resolveMainServices(
      createMainContainer({ mode: 'local', skillProviderHost, ...runtime })
    )
    registerAgentIpcHandlers(ipcMain, runtime.runtimeClient)
    await runtime.runtimeSupervisor.start()
  }

  createWindow(services)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(services)
  })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (!services?.runtimeSupervisor || quitting) return
  event.preventDefault()
  quitting = true
  void services.runtimeSupervisor.stop().finally(() => app.quit())
})
