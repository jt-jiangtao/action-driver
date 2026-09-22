import { app, BrowserWindow, ipcMain, nativeImage, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MainServices } from './container'
import { createMainContainer, resolveMainServices } from './container'
import { applyApplicationName, resolveDesktopIconPath } from './app-identity'
import { registerAgentIpcHandlers } from './agent-ipc'
import { createLocalRuntimeServices } from './local-runtime'
import { registerModelIpcHandlers } from './model-ipc'
import { registerLogIpcHandlers } from './logs-ipc'
import { createMainLogging, type MainLogging } from './logging'
import { createModelConnectionStore, createNodeFileSystem } from './model-connections/connection-store'
import { createFetchHttpTransport } from './model-connections/http-transport'
import { ModelConnectionService } from './model-connections/model-connection-service'
import { createSecretCipher } from './model-connections/secret-cipher'
import { installNavigationGuards } from './navigation-security'
import { resolveRuntimePaths } from './runtime-paths'
import { createMockSkillProviderHost } from './skill-provider-host'
import { resolveDesktopCompositionMode } from '../shared/composition-mode'
import { resolveCredentialKey } from './credential-key'

const desktopIconPath = resolveDesktopIconPath(__dirname)
const compositionMode = resolveDesktopCompositionMode(import.meta.env.MODE)
let services: MainServices
let logging: MainLogging | undefined
let quitting = false

applyApplicationName(app)

/**
 * Sets the Dock icon from the brand asset. A missing or unreadable asset is reported loudly instead
 * of silently leaving the Electron icon in place.
 */
function applyDesktopBranding(): void {
  const icon = nativeImage.createFromPath(desktopIconPath)
  if (icon.isEmpty()) {
    console.error(`[branding] ActionDriver icon could not be loaded from ${desktopIconPath}`)
    return
  }
  app.dock?.setIcon(icon)
}

function createWindow(mainServices: MainServices): BrowserWindow {
  const rendererPath = join(__dirname, '../renderer/index.html')
  const rendererEntryUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  const window = new BrowserWindow(
    mainServices.windowOptionsFactory(join(__dirname, '../preload/index.cjs'), desktopIconPath)
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
  applyDesktopBranding()
  logging = createMainLogging({ userDataPath: app.getPath('userData') })
  registerLogIpcHandlers(
    ipcMain,
    [
      { filePath: join(app.getPath('userData'), 'logs', 'renderer-service.log') },
      { filePath: join(app.getPath('userData'), 'logs', 'service.log') }
    ],
    logging.interactions
  )
  if (compositionMode === 'mock') {
    services = resolveMainServices(createMainContainer({ mode: 'mock' }))
  } else {
    const skillProviderHost = createMockSkillProviderHost()
    const modelConnectionService = new ModelConnectionService({
      store: createModelConnectionStore({
        filePath: join(app.getPath('userData'), 'data', 'model-connections.json'),
        fs: createNodeFileSystem()
      }),
      cipher: createSecretCipher(safeStorage),
      transport: createFetchHttpTransport()
    })
    const paths = resolveRuntimePaths({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      platform: process.platform,
      arch: process.arch
    })
    const serviceToken = randomBytes(24).toString('base64url')
    const credentialKey = resolveCredentialKey({
      userDataPath: app.getPath('userData'),
      cipher: safeStorage
    })
    const runtime = createLocalRuntimeServices(paths, app.getVersion(), skillProviderHost, {
      serviceToken,
      credentialKey: credentialKey.toString('base64')
    })
    services = resolveMainServices(
      createMainContainer({
        mode: 'local',
        skillProviderHost,
        modelConnectionService,
        ...runtime
      })
    )
    registerAgentIpcHandlers(ipcMain, runtime.runtimeClient, logging.interactions)
    registerModelIpcHandlers(ipcMain, modelConnectionService, logging.interactions)
    await runtime.runtimeSupervisor.start()
  }

  createWindow(services)
  // macOS can reset the Dock tile when the first window is created; re-apply after it exists.
  applyDesktopBranding()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(services)
  })
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (!services?.runtimeSupervisor || quitting) return
  event.preventDefault()
  quitting = true
  // Never leave a lingering Dock tile: quit even if the supervisor shutdown stalls.
  const forceQuit = setTimeout(() => app.exit(0), 3_000)
  void services.runtimeSupervisor
    .stop()
    .catch(() => undefined)
    .then(() => logging?.logger.close())
    .finally(() => {
      clearTimeout(forceQuit)
      app.quit()
    })
})
