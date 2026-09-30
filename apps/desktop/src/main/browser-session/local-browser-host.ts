import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import type { BrowserContext, Page } from 'playwright-core'
import { readApiManifest } from '@action-driver/browser-runtime'
import type { ProductBrowserHost, BrowserHostSetup } from '@action-driver/browser-runtime'
import { LocalCdpAdapter } from './local-cdp-adapter.js'

const defaultChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const privateAppPath = /\/Applications\/(?:ChatGPT|Codex)\.app\/Contents\/Resources(?:\/|$)/u
const supportedMembers = new Set([
  'Agent.browsers', 'Browsers.list', 'Browsers.get', 'Browsers.getDefault', 'Browsers.getForUrl',
  'Browser.browserId', 'Browser.tabs', 'Browser.user',
  'BrowserUser.openTabs', 'BrowserUser.claimTab',
  'Tabs.new', 'Tabs.list', 'Tabs.get',
  'Tab.id', 'Tab.goto', 'Tab.close', 'Tab.screenshot', 'Tab.title', 'Tab.url', 'Tab.cua',
  'CUAAPI.click', 'CUAAPI.double_click', 'CUAAPI.drag', 'CUAAPI.keypress',
  'CUAAPI.move', 'CUAAPI.scroll', 'CUAAPI.type'
])

export interface LocalBrowserHostOptions {
  profileRoot: string
  browserExecutable?: string | undefined
  launch?: (profilePath: string, executablePath: string) => Promise<BrowserContext>
}

function browserInfo() {
  return { id: 'local', name: 'Action-Driver Chrome', type: 'cdp' as const,
    family: 'chrome', capabilities: { browser: [], tab: [] } }
}

/** Owns a separate Chrome profile and accepts only a deliberate local browser host. */
export async function createLocalBrowserHost(options: LocalBrowserHostOptions): Promise<ProductBrowserHost> {
  if (process.platform !== 'darwin') throw new Error('BROWSER_PLATFORM_UNSUPPORTED')
  const profileRoot = resolve(options.profileRoot)
  const executable = resolve(options.browserExecutable ?? defaultChrome)
  if (privateAppPath.test(profileRoot) || privateAppPath.test(executable))
    throw new Error('BROWSER_PRIVATE_PATH')
  if (!options.launch) await access(executable)
  await mkdir(profileRoot, { recursive: true, mode: 0o700 })
  const profile = await mkdtemp(join(profileRoot, 'session-'))
  let context: BrowserContext
  try {
    context = options.launch
      ? await options.launch(profile, executable)
      : await chromium.launchPersistentContext(profile, {
        executablePath: executable,
        headless: false,
        acceptDownloads: true
      })
  } catch (error) {
    await rm(profile, { recursive: true, force: true })
    throw error
  }
  let closed = false
  let closing: Promise<void> | undefined
  let nextTab = 0
  const pages = new Map<string, Page>()
  const cdp = new Map<string, Promise<LocalCdpAdapter>>()
  const ids = new WeakMap<Page, string>()
  const idFor = (page: Page) => {
    let id = ids.get(page)
    if (!id) {
      id = String(++nextTab)
      ids.set(page, id)
      pages.set(id, page)
      page.on?.('close', () => { pages.delete(id!) })
    }
    return id
  }
  const currentPages = () => {
    for (const page of context.pages()) idFor(page)
    return [...pages.entries()]
  }
  const tab = (id: unknown): Page => {
    if (typeof id !== 'string') throw new Error('BROWSER_TAB_REQUIRED')
    currentPages()
    const page = pages.get(id)
    if (!page) throw new Error(`BROWSER_TAB_UNAVAILABLE: ${id}`)
    return page
  }
  const cdpFor = (id: unknown): Promise<LocalCdpAdapter> => {
    const page = tab(id)
    const key = String(id)
    let adapter = cdp.get(key)
    if (!adapter) {
      adapter = context.newCDPSession(page).then((session) =>
        new LocalCdpAdapter(session, Number(key)))
      cdp.set(key, adapter)
      void adapter.catch(() => { if (cdp.get(key) === adapter) cdp.delete(key) })
    }
    return adapter
  }
  const assertOpen = () => {
    if (closed) throw new Error('BROWSER_HOST_CLOSED')
  }
  const assertBrowser = (command: Record<string, unknown>) => {
    if (command.browser_id !== 'local') throw new Error('BROWSER_UNAVAILABLE')
  }
  const position = (command: Record<string, unknown>) => {
    if (typeof command.x !== 'number' || !Number.isFinite(command.x) ||
        typeof command.y !== 'number' || !Number.isFinite(command.y))
      throw new Error('BROWSER_COORDINATES_REQUIRED')
    return [command.x, command.y] as const
  }
  const noModifiers = (command: Record<string, unknown>) => {
    if (Array.isArray(command.keys) && command.keys.length)
      throw new Error('BROWSER_MODIFIER_UNAVAILABLE')
  }
  return {
    async setup(_options: BrowserHostSetup) {
      assertOpen()
      const apiManifest = await readApiManifest(undefined, { environment: 'training' })
      const disabledMemberIds = Object.entries(apiManifest.interfaces)
        .flatMap(([name, members]) => Object.keys(members).map((member) => `${name}.${member}`))
        .filter((id) => !supportedMembers.has(id))
      return { apiManifest, disabledMemberIds }
    },
    async execute(command) {
      assertOpen()
      switch (command.type) {
        case 'list_browsers': return [browserInfo()]
        case 'get_browser':
          if (command.id !== 'local') throw new Error('BROWSER_UNAVAILABLE')
          return browserInfo()
        case 'get_default_browser': return browserInfo()
        case 'get_browser_for_url': {
          if (typeof command.url !== 'string' ||
              !currentPages().some(([, page]) => page.url() === command.url))
            throw new Error('BROWSER_URL_UNAVAILABLE')
          return browserInfo()
        }
        case 'list_tabs':
        case 'browser_user_open_tabs':
          assertBrowser(command)
          return { tabs: await Promise.all(currentPages().map(async ([id, page]) => ({
            id, url: page.url(), title: await page.title()
          }))) }
        case 'get_tab': {
          assertBrowser(command)
          const page = tab(command.tab_id)
          return { id: command.tab_id, url: page.url(), title: await page.title() }
        }
        case 'browser_user_claim_tab': {
          assertBrowser(command)
          const page = tab(command.tab_id)
          return { id: command.tab_id, url: page.url(), title: await page.title() }
        }
        case 'cua_click': {
          assertBrowser(command); noModifiers(command)
          const [x, y] = position(command)
          const button = command.button === 1 || command.button == null ? 'left'
            : command.button === 2 ? 'middle' : command.button === 3 ? 'right' : undefined
          if (!button) throw new Error('BROWSER_MOUSE_BUTTON_UNAVAILABLE')
          await tab(command.tab_id).mouse.click(x, y, { button })
          return {}
        }
        case 'cua_double_click': {
          assertBrowser(command); noModifiers(command)
          await tab(command.tab_id).mouse.dblclick(...position(command))
          return {}
        }
        case 'cua_move': {
          assertBrowser(command); noModifiers(command)
          await tab(command.tab_id).mouse.move(...position(command))
          return {}
        }
        case 'cua_drag': {
          assertBrowser(command); noModifiers(command)
          if (!Array.isArray(command.path) || command.path.length < 2)
            throw new Error('BROWSER_DRAG_PATH_REQUIRED')
          const path = command.path.map((item: unknown) =>
            position(item != null && typeof item === 'object' ? item as Record<string, unknown> : {}))
          const mouse = tab(command.tab_id).mouse
          await mouse.move(...path[0]!)
          await mouse.down()
          try { for (const point of path.slice(1)) await mouse.move(...point) }
          finally { await mouse.up() }
          return {}
        }
        case 'cua_scroll': {
          assertBrowser(command); noModifiers(command)
          const [x, y] = position(command)
          if (typeof command.scroll_x !== 'number' || !Number.isFinite(command.scroll_x) ||
              typeof command.scroll_y !== 'number' || !Number.isFinite(command.scroll_y))
            throw new Error('BROWSER_SCROLL_REQUIRED')
          const mouse = tab(command.tab_id).mouse
          await mouse.move(x, y)
          await mouse.wheel(command.scroll_x, command.scroll_y)
          return {}
        }
        case 'cua_keypress': {
          assertBrowser(command)
          if (!Array.isArray(command.keys) || command.keys.length !== 1 ||
              typeof command.keys[0] !== 'string')
            throw new Error('BROWSER_KEY_COMBINATION_UNAVAILABLE')
          const key = command.keys[0] === 'ENTER' ? 'Enter' : command.keys[0]
          await tab(command.tab_id).keyboard.press(key)
          return {}
        }
        case 'cua_type': {
          assertBrowser(command)
          if (typeof command.text !== 'string') throw new Error('BROWSER_TEXT_REQUIRED')
          await tab(command.tab_id).keyboard.insertText(command.text)
          return {}
        }
        case 'create_tab': {
          assertBrowser(command)
          return { id: idFor(await context.newPage()) }
        }
        case 'close_tab':
          assertBrowser(command)
          if (cdp.has(String(command.tab_id))) {
            await (await cdp.get(String(command.tab_id))!).close()
            cdp.delete(String(command.tab_id))
          }
          await tab(command.tab_id).close()
          pages.delete(String(command.tab_id))
          return {}
        case 'navigate_tab_url': {
          assertBrowser(command)
          if (typeof command.url !== 'string' || !/^https?:\/\//u.test(command.url))
            throw new Error('BROWSER_NAVIGATION_UNAVAILABLE')
          await tab(command.tab_id).goto(command.url)
          return {}
        }
        case 'tab_screenshot': {
          assertBrowser(command)
          const cropped = ['cropX', 'cropY', 'cropWidth', 'cropHeight']
            .some((key) => command[key] !== undefined)
          const clip = cropped ? {
            x: command.cropX, y: command.cropY,
            width: command.cropWidth, height: command.cropHeight
          } : undefined
          if (clip && Object.values(clip).some((value) =>
            typeof value !== 'number' || !Number.isFinite(value)) ||
            clip && ((clip.width as number) <= 0 || (clip.height as number) <= 0))
            throw new Error('BROWSER_SCREENSHOT_CLIP_INVALID')
          const data = await tab(command.tab_id).screenshot({
            fullPage: command.fullPage === true,
            ...(clip ? { clip: clip as { x: number; y: number; width: number; height: number } } : {})
          })
          return { data: Buffer.from(data).toString('base64') }
        }
        case 'tab_cdp_call': {
          assertBrowser(command)
          if (command.target != null) throw new Error('BROWSER_CDP_TARGET_UNAVAILABLE')
          if (typeof command.method !== 'string' || !command.method)
            throw new Error('BROWSER_CDP_METHOD_REQUIRED')
          return (await cdpFor(command.tab_id)).send(command.method,
            command.params != null && typeof command.params === 'object'
              ? command.params as Record<string, unknown> : {})
        }
        case 'tab_cdp_events': {
          assertBrowser(command)
          if (command.target != null) throw new Error('BROWSER_CDP_TARGET_UNAVAILABLE')
          return (await cdpFor(command.tab_id)).readEvents({
            afterSequence: command.after_sequence as number | undefined,
            limit: command.limit as number | undefined,
            methods: command.methods as string[] | undefined,
            timeoutMs: command.timeout_ms as number | undefined
          })
        }
        default: throw new Error(`BROWSER_COMMAND_UNAVAILABLE: ${String(command.type)}`)
      }
    },
    async displayImage() { assertOpen() },
    close() {
      if (!closing) {
        closed = true
        closing = (async () => {
          try {
            await Promise.allSettled([...cdp.values()].map(async (entry) => (await entry).close()))
            cdp.clear()
            await context.close()
          }
          finally { pages.clear(); await rm(profile, { recursive: true, force: true }) }
        })()
      }
      return closing
    }
  }
}
