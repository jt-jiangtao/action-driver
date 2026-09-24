import { app, BrowserWindow, ipcMain, nativeImage, net, protocol, safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MainServices } from './container'
import { createMainServices } from './container'
import { applyApplicationName, resolveDesktopIconPath } from './app-identity'
import { createLocalRuntimeServices } from './local-runtime'
import { createMainLogging, type MainLogging } from './logging'
import {
  createModelConnectionStore,
  createNodeFileSystem
} from './model-connections/connection-store'
import { ModelConnectionHttpClient } from './model-connections/http-client'
import { createSecretCipher } from './model-connections/secret-cipher'
import { installNavigationGuards, resolveTrustedRendererOrigin } from './navigation-security'
import { resolveRuntimePaths } from './runtime-paths'
import { createProductionSkillProviderHost } from './skill-provider-host'
import { resolveDesktopCompositionMode } from '../shared/composition-mode'
import { resolveCredentialKey } from './credential-key'
import { resolveModuleDirectory } from './module-directory'
import { registerRuntimeConnectionIpc } from './runtime-connection-ipc'
import { PACKAGED_RENDERER_URL, resolveRendererAssetPath } from './renderer-protocol'

protocol.registerSchemesAsPrivileged([{
  scheme: 'actiondriver',
  privileges: { standard: true, secure: true, supportFetchAPI: true }
}])

const moduleDirectory = resolveModuleDirectory(import.meta.url)
const desktopIconPath = resolveDesktopIconPath(moduleDirectory)
const rendererPath = join(moduleDirectory, '../renderer/index.html')
const rendererEntryUrl = process.env.ELECTRON_RENDERER_URL ?? PACKAGED_RENDERER_URL
const trustedRendererOrigin = resolveTrustedRendererOrigin(rendererEntryUrl)
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
  const window = new BrowserWindow(
    mainServices.windowOptionsFactory(
      join(moduleDirectory, '../preload/index.cjs'),
      desktopIconPath
    )
  )

  installNavigationGuards(window.webContents, rendererEntryUrl)
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(rendererEntryUrl)
  } else {
    void window.loadURL(rendererEntryUrl)
  }
  return window
}

app.whenReady().then(async () => {
  protocol.handle('actiondriver', (request) => {
    const path = resolveRendererAssetPath(dirname(rendererPath), request.url)
    return path
      ? net.fetch(pathToFileURL(path).href)
      : new Response('Not found', { status: 404 })
  })
  applyDesktopBranding()
  logging = await createMainLogging()
  if (compositionMode === 'mock') {
    services = createMainServices({ mode: 'mock' })
  } else {
    const skillProviderHost = createProductionSkillProviderHost()
    const agentHomeDirectory =
      !app.isPackaged && process.env.ACTIONDRIVER_E2E_HOME_DIRECTORY
        ? process.env.ACTIONDRIVER_E2E_HOME_DIRECTORY
        : app.getPath('home')
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
      userDataPath: app.getPath('userData')
    })
    const runtime = createLocalRuntimeServices(paths, skillProviderHost, {
      serviceToken,
      credentialKey: credentialKey.toString('base64'),
      agentHomeDirectory,
      ...(trustedRendererOrigin ? { trustedRendererOrigin } : {}),
    })
    services = createMainServices({ mode: 'local', skillProviderHost, ...runtime })
    await runtime.runtimeSupervisor.start()
    const serviceDescriptor = runtime.runtimeSupervisor.serviceDescriptor
    if (!serviceDescriptor) throw new Error('Local service did not report a stream surface')
    registerRuntimeConnectionIpc(ipcMain, serviceDescriptor, serviceToken)
    const serviceUrl = runtime.runtimeSupervisor.serviceUrl
    if (!serviceUrl) throw new Error('Local service did not report an HTTP surface')
    const modelConnectionClient = new ModelConnectionHttpClient({
      baseUrl: serviceUrl,
      token: serviceToken
    })
    try {
      await migrateLegacyModelConnections(
        modelConnectionClient,
        app.getPath('userData'),
        safeStorage
      )
    } catch (error) {
      console.warn(
        '[model-connections] legacy migration failed; keeping the old file:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  createWindow(services)
  // macOS can reset the Dock tile when the first window is created; re-apply after it exists.
  applyDesktopBranding()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(services)
  })
})

async function migrateLegacyModelConnections(
  client: ModelConnectionHttpClient,
  userDataPath: string,
  safeStorageLike: Parameters<typeof createSecretCipher>[0]
): Promise<void> {
  const filePath = join(userDataPath, 'data', 'model-connections.json')
  const legacy = createModelConnectionStore({
    filePath,
    fs: createNodeFileSystem()
  }).read()
  if (legacy.length === 0) return

  const cipher = createSecretCipher(safeStorageLike)
  let migrated = 0
  for (const connection of legacy) {
    try {
      await client.add({
        draft: {
          name: connection.name,
          protocol: connection.protocol,
          baseUrl: connection.baseUrl,
          apiKey: cipher.decrypt(connection.apiKeyCipher)
        },
        models: connection.models
      })
      migrated += 1
    } catch (error) {
      console.warn(
        `[model-connections] could not migrate "${connection.name}"; keeping the legacy file:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  if (migrated === legacy.length) unlinkSync(filePath)
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (!services?.runtimeSupervisor || quitting) return
  event.preventDefault()
  quitting = true
  // Never leave a lingering Dock tile: quit even if the supervisor shutdown stalls.
  const forceQuit = setTimeout(() => app.exit(0), 3_000)
  void services?.runtimeSupervisor
    ?.stop()
    .catch(() => undefined)
    .then(() => logging?.logger.close())
    .finally(() => {
      clearTimeout(forceQuit)
      app.quit()
    })
})
