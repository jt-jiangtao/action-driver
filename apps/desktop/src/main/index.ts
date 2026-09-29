import { readFile } from 'node:fs/promises'
import { validateManifest, PluginError, PLUGIN_UI_PROTOCOL_VERSION, type Json } from '@actiondriver/plugin-contracts'
import { createPanelMessageClient } from './plugins/panel-message-client'
import { createPluginPanelProvider } from './plugins/panel-provider'
import { createPluginContributionClient } from './plugins/contribution-client'
import { PLUGIN_COMMAND_EXECUTE_CHANNEL, PLUGIN_CONTRIBUTIONS_LIST_CHANNEL, PLUGIN_VIEW_OPEN_CHANNEL } from '../shared/plugin-contributions-contract'
import { createElectronPluginPanelHost } from './plugins/electron-panel-host'
import { app, BrowserWindow, WebContentsView, dialog, ipcMain, nativeImage, net, protocol, safeStorage, shell } from 'electron'
import { createLocalBrowserHost } from './browser-session/local-browser-host.js'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
import { ComputerUseClient, owningAppBundle } from './computer-use-client'
import { createComputerUseProvider } from './computer-use-provider'
import { registerComputerUsePermissionsIpc } from './computer-use-permissions-ipc'
import {
  registerComputerUseGuidanceIpc
} from './computer-use-guidance'
import { resolveDesktopCompositionMode } from '../shared/composition-mode'
import { resolveCredentialKey } from './credential-key'
import { resolveModuleDirectory } from './module-directory'
import { registerExternalLinkIpc } from './external-link-ipc'
import { registerTaskOutputIpc } from './task-output-ipc'
import { registerRuntimeConnectionIpc } from './runtime-connection-ipc'
import { createDesktopBrowserSessionManager } from './browser-session/manager'
import type { BrowserSessionSnapshot } from '@actiondriver/browser-desktop'
import { createEmbeddedBrowserHost } from './browser-session/embedded-host'
import { createExternalChromeHost } from './browser-session/external-chrome-host'
import { createBrowserUseProvider } from './browser-session/provider'
import type { createTaskBrowserBinding } from './browser-session/task-binding'
import {
  BROWSER_SESSION_COMMAND_CHANNEL,
  BROWSER_SESSION_EVENT_CHANNEL,
  BROWSER_SESSION_VIEWPORT_CHANNEL
} from '../shared/browser-session-contract'
import { PACKAGED_RENDERER_URL, resolveRendererAssetPath } from './renderer-protocol'
import {
  SKILL_FOLDER_BROWSE_CHANNEL,
  SKILL_FOLDER_CHOOSE_CHANNEL,
  SKILL_FOLDER_REVEAL_CHANNEL
} from '../shared/skill-folder-contract'

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
let computerUseClient: ComputerUseClient | null = null
let browserBinding: ReturnType<typeof createTaskBrowserBinding> | null = null
let browserEventSink: ((taskId: string, snapshot: BrowserSessionSnapshot | null) => void) | null = null

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
  if (compositionMode !== 'mock') {
    const browserSessions = createDesktopBrowserSessionManager({
      ipc: ipcMain,
      isTrustedSender: (event) => (event as { sender?: unknown })?.sender === window.webContents,
      emit: (taskId, snapshot) => {
        if (!window.isDestroyed())
          window.webContents.send(BROWSER_SESSION_EVENT_CHANNEL, { taskId, snapshot })
      },
      createEmbeddedHost: async (onChanged) => createEmbeddedBrowserHost(
        window, (options) => new WebContentsView(options), onChanged
      ),
      createExternalHost: async () => createExternalChromeHost(await createLocalBrowserHost({
        profileRoot: join(app.getPath('userData'), 'browser-profiles')
      }))
    })
    browserBinding = browserSessions.binding
    browserEventSink = (taskId, snapshot) => {
      if (!window.isDestroyed())
        window.webContents.send(BROWSER_SESSION_EVENT_CHANNEL, { taskId, snapshot })
    }
    window.once('closed', () => {
      void browserSessions.dispose()
      if (browserBinding === browserSessions.binding) browserBinding = null
      browserEventSink = null
      ipcMain.removeHandler(BROWSER_SESSION_COMMAND_CHANNEL)
      ipcMain.removeHandler(BROWSER_SESSION_VIEWPORT_CHANNEL)
    })
  }
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(rendererEntryUrl)
  } else {
    void window.loadURL(rendererEntryUrl)
  }
  return window
}

/** Reads the live helper status; an unreachable helper returns null (status unknown). */
async function readComputerUsePermissions() {
  if (!computerUseClient) return null
  const result = await computerUseClient.execute({
    version: 1,
    requestId: randomBytes(12).toString('hex'),
    deadlineUnixMs: Date.now() + 30_000,
    operation: 'permissions'
  })
  if (typeof result !== 'object' || result === null) return null
  const status = result as Record<string, unknown>
  if (typeof status.accessibility !== 'boolean' || typeof status.screenRecording !== 'boolean' ||
      typeof status.eventPosting !== 'boolean' || typeof status.permissionTarget !== 'string')
    return null
  return {
    accessibility: status.accessibility,
    screenRecording: status.screenRecording,
    eventPosting: status.eventPosting,
    permissionTarget: status.permissionTarget
  }
}

let pluginPanels: ReturnType<typeof createPluginPanelProvider> | undefined
/** Renderer input is validated here; availability and grants stay with the runtime. */
function parsePluginViewOpen(value: unknown): { pluginId: string; viewId: string } {
  const input = value as { pluginId?: unknown; viewId?: unknown } | null
  if (!input || typeof input.pluginId !== 'string' || !input.pluginId || typeof input.viewId !== 'string' || !input.viewId) throw new Error('Plugin view request is invalid')
  return { pluginId: input.pluginId, viewId: input.viewId }
}
function parsePluginCommandExecute(value: unknown): { pluginId: string; commandId: string; input: Json; taskId?: string } {
  const request = value as { pluginId?: unknown; commandId?: unknown; taskId?: unknown; input?: unknown } | null
  if (!request || typeof request.pluginId !== 'string' || !request.pluginId || typeof request.commandId !== 'string' || !request.commandId) throw new Error('Plugin command request is invalid')
  if (request.taskId !== undefined && (typeof request.taskId !== 'string' || !request.taskId)) throw new Error('Plugin command request is invalid')
  return { pluginId: request.pluginId, commandId: request.commandId, input: (request.input ?? null) as Json, ...(request.taskId === undefined ? {} : { taskId: request.taskId as string }) }
}
app.whenReady().then(async () => {
  registerExternalLinkIpc(ipcMain, (url) => shell.openExternal(url))
  protocol.handle('actiondriver', (request) => {
    const path = resolveRendererAssetPath(dirname(rendererPath), request.url)
    return path
      ? net.fetch(pathToFileURL(path).href)
      : new Response('Not found', { status: 404 })
  })
  applyDesktopBranding()
  logging = await createMainLogging()
  const agentHomeDirectory =
    !app.isPackaged && process.env.ACTIONDRIVER_E2E_HOME_DIRECTORY
      ? process.env.ACTIONDRIVER_E2E_HOME_DIRECTORY
      : app.getPath('home')
  const skillsDirectory = join(agentHomeDirectory, '.action-driver', 'skills')
  ipcMain.handle(SKILL_FOLDER_CHOOSE_CHANNEL, async () => {
    const chosen = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return chosen.canceled ? null : chosen.filePaths[0] ?? null
  })
  ipcMain.handle(SKILL_FOLDER_BROWSE_CHANNEL, async () => {
    mkdirSync(skillsDirectory, { recursive: true })
    const error = await shell.openPath(skillsDirectory)
    if (error) throw new Error(error)
  })
  ipcMain.handle(SKILL_FOLDER_REVEAL_CHANNEL, (_event, input: unknown) => {
    const skillId = (input as { skillId?: unknown })?.skillId
    if (typeof skillId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillId)) {
      throw new Error('Skill 标识无效。')
    }
    const system = new Set(['computer-use', 'documents', 'imagegen', 'pdf', 'presentations',
      'skill-creator', 'spreadsheets'])
    const path = join(skillsDirectory, system.has(skillId) ? '.system' : '', skillId)
    shell.showItemInFolder(path)
  })
  if (compositionMode === 'mock') {
    services = createMainServices({ mode: 'mock' })
  } else {
    const skillProviderHost = createProductionSkillProviderHost()
    skillProviderHost.register(createBrowserUseProvider(() => browserBinding,
      (taskId, snapshot) => browserEventSink?.(taskId, snapshot)))
    const paths = resolveRuntimePaths({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      platform: process.platform,
      arch: process.arch
    })
    const pluginPackageRoot = (owner: { pluginId: string; version: string }) => join(dirname(paths.databasePath), 'plugins/installed', owner.pluginId, owner.version)
    const pluginContributions = createPluginContributionClient({ fetch: globalThis.fetch, connection: () => { const url = runtime.runtimeSupervisor.serviceUrl; if (!url) throw new PluginError('UNAVAILABLE', 'Runtime is not ready'); return { url, token: serviceToken } } })
    ipcMain.handle(PLUGIN_CONTRIBUTIONS_LIST_CHANNEL, async () => pluginContributions.list())
    ipcMain.handle(PLUGIN_VIEW_OPEN_CHANNEL, async (_event, input: unknown) => {
      const parsed = parsePluginViewOpen(input)
      await pluginContributions.openView(parsed.pluginId, parsed.viewId)
    })
    ipcMain.handle(PLUGIN_COMMAND_EXECUTE_CHANNEL, async (_event, input: unknown) => {
      const parsed = parsePluginCommandExecute(input)
      return pluginContributions.executeCommand(parsed.pluginId, parsed.commandId, parsed.input, parsed.taskId)
    })
    pluginPanels = createPluginPanelProvider({
      loadManifest: async owner => validateManifest(JSON.parse(await readFile(join(pluginPackageRoot(owner), 'plugin.json'), 'utf8')), { sdk: '1.0.0', platform: `${process.platform}-${process.arch}`, uiProtocol: PLUGIN_UI_PROTOCOL_VERSION }),
      createHost: ports => createElectronPluginPanelHost({ ...ports, ids: () => randomBytes(16).toString('hex'), packageRoot: pluginPackageRoot, preload: join(moduleDirectory, '../preload/pluginPanel.cjs'), message: createPanelMessageClient({ fetch: globalThis.fetch, connection: () => { const url = runtime.runtimeSupervisor.serviceUrl; if (!url) throw new PluginError('UNAVAILABLE', 'Runtime is not ready'); return { url, token: serviceToken } } }) })
    })
    skillProviderHost.register(pluginPanels.provider)
    if (existsSync(paths.computerHelperPath)) {
      // LaunchServices owns the helper process so macOS attributes its permissions to the helper.
      // The socket lives in the short per-user temp directory: Unix domain socket paths are capped
      // at ~104 bytes and application-support paths can exceed that.
      computerUseClient = new ComputerUseClient({
        helperPath: paths.computerHelperBundlePath,
        socketPath: join(tmpdir(), 'actiondriver-computer-use.sock'),
        tokenPath: join(tmpdir(), 'actiondriver-computer-use.token'),
        ...(owningAppBundle(process.execPath) ? { ownerAppPath: owningAppBundle(process.execPath)! } : {})
      })
      skillProviderHost.register(createComputerUseProvider(computerUseClient))
    }
    registerComputerUsePermissionsIpc(ipcMain, computerUseClient, async () => {
      const error = await shell.openPath('/System/Applications/System Settings.app')
      if (error) throw new Error(error)
    })
    registerComputerUseGuidanceIpc(ipcMain, {
      // The guidance window is native and lives inside the helper process, which also owns the
      // permission prompts; Main only asks it to present itself.
      present: async () => {
        if (!computerUseClient) return
        await computerUseClient.execute({
          version: 1,
          requestId: randomBytes(12).toString('hex'),
          deadlineUnixMs: Date.now() + 30_000,
          operation: 'guidance'
        })
      },
      readPermissions: readComputerUsePermissions
    })
    const serviceToken = randomBytes(24).toString('base64url')
    const credentialKey = resolveCredentialKey({
      userDataPath: app.getPath('userData')
    })
    const runtime = createLocalRuntimeServices(paths, skillProviderHost, {
      serviceToken,
      capabilityDisconnected: () => { void pluginPanels?.disconnected().catch(error => console.error(error)) },
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
    registerTaskOutputIpc(ipcMain, {
      connection: async () => ({ serviceUrl: serviceUrl!, token: serviceToken }),
      openPath: (path) => shell.openPath(path)
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
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[desktop] startup failed:', error)
  dialog.showErrorBox('ActionDriver 启动失败', message)
  app.quit()
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
  computerUseClient?.close()
  void pluginPanels?.dispose().catch(error => console.error(error))
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
