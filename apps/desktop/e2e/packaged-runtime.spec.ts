import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appPath = process.env.ACTIONDRIVER_PACKAGED_APP
test.skip(!appPath, 'Set ACTIONDRIVER_PACKAGED_APP to a macOS application bundle')

test('packaged macOS app boots its bundled Runtime and authenticates the Renderer', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'actiondriver-packaged-data-'))
  const home = mkdtempSync(join(tmpdir(), 'actiondriver-packaged-home-'))
  const application = await electron.launch({
    executablePath: join(appPath!, 'Contents', 'MacOS', 'ActionDriver'),
    args: [`--user-data-dir=${userData}`],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
        Boolean(entry[1]))),
      HOME: home,
      ACTIONDRIVER_E2E_HOME_DIRECTORY: home
    }
  })
  try {
    const runtime = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath,
      defaultApp: process.defaultApp
    }))
    expect(runtime.isPackaged, JSON.stringify(runtime)).toBe(true)
    const page = await application.firstWindow()
    await expect(page.getByText('我们应该在 ActionDriver 中做些什么？')).toBeVisible()
    expect(page.url()).toBe('actiondriver://renderer/index.html')
    const result = await page.evaluate(async () => {
      const connection = await window.actionDriverDesktop.runtimeConnection.get()
      const url = new URL(connection.wsUrl)
      url.protocol = 'http:'
      url.pathname = '/model-connections'
      const authorized = await fetch(url, {
        headers: { Authorization: `Bearer ${connection.accessToken}` }
      })
      const unauthorized = await fetch(url)
      return { authorized: authorized.status, unauthorized: unauthorized.status }
    })
    expect(result).toEqual({ authorized: 200, unauthorized: 401 })
  } finally {
    await application.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
