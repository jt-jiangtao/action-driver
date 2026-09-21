import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMainContainer, resolveMainServices } from './container'
import { applyApplicationName, applyDockIcon, resolveDesktopIconPath } from './app-identity'
import { installNavigationGuards } from './navigation-security'

const services = resolveMainServices(createMainContainer())
const desktopIconPath = resolveDesktopIconPath(__dirname)

applyApplicationName(app)

function createWindow(): BrowserWindow {
  const rendererPath = join(__dirname, '../renderer/index.html')
  const rendererEntryUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(rendererPath).href
  const window = new BrowserWindow(
    services.windowOptionsFactory(join(__dirname, '../preload/index.mjs'), desktopIconPath)
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

app.whenReady().then(() => {
  applyDockIcon(app, desktopIconPath)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
