import { createBrowserSession, type SessionBrowsers } from './browser-session.js'
import { createComputerSession, type MacComputer, type SessionHost } from './computer-session.js'
import { createSessionLifecycle } from './session-lifecycle.js'
import { getState } from './discovery.js'

type BrowserSession = Awaited<ReturnType<typeof createBrowserSession>>
type ComputerSession = Awaited<ReturnType<typeof createComputerSession>>
type BrowserMembers = Pick<
  BrowserSession,
  'browsers' | 'getBrowser' | 'createBrowserTab' | 'getTab' | 'listBrowsers' | 'listTabs'
>
type ComputerMembers = Pick<ComputerSession, 'computer' | 'listApps' | 'getApp'>
export interface CUASessionOptions {
  agent?: { browsers: SessionBrowsers } | undefined
  computer?: MacComputer | undefined
  getHost?: (() => SessionHost | undefined) | undefined
}
interface SharedSession {
  rewriteDocumentation(): Promise<void>
  getState(options?: { emit?: boolean }): ReturnType<typeof getState>
}
export function createCUASession(
  options: CUASessionOptions & {
    agent: NonNullable<CUASessionOptions['agent']>
    computer: MacComputer
  }
): Promise<SharedSession & BrowserMembers & ComputerMembers>
export function createCUASession(
  options: CUASessionOptions & {
    agent: NonNullable<CUASessionOptions['agent']>
    computer?: undefined
  }
): Promise<SharedSession & BrowserMembers>
export function createCUASession(
  options: CUASessionOptions & { agent?: undefined; computer: MacComputer }
): Promise<SharedSession & ComputerMembers>
export function createCUASession(
  options?: CUASessionOptions
): Promise<SharedSession & Partial<BrowserMembers & ComputerMembers>>
/** Shared session assembly over browser and computer backends. */
export async function createCUASession({
  agent,
  computer,
  getHost = () => undefined
}: CUASessionOptions = {}) {
  if (computer && computer.target !== 'mac')
    throw new Error('Computer sessions currently support macOS only.')
  const lifecycle = createSessionLifecycle(getHost)
  await lifecycle.emit()
  const browser = agent ? await createBrowserSession({ agent, getHost, lifecycle }) : undefined
  const desktop = computer
    ? await createComputerSession({ computer, getHost, lifecycle })
    : undefined
  return {
    rewriteDocumentation: lifecycle.rewriteDocumentation,
    async getState(options?: { emit?: boolean }) {
      const state = await getState({
        ...(agent ? { browsers: agent.browsers } : {}),
        ...(computer ? { computer } : {})
      })
      await lifecycle.emit(state, options)
      return state
    },
    ...(browser
      ? {
          browsers: browser.browsers,
          getBrowser: browser.getBrowser,
          createBrowserTab: browser.createBrowserTab,
          getTab: browser.getTab,
          listBrowsers: browser.listBrowsers,
          listTabs: browser.listTabs
        }
      : {}),
    ...(desktop
      ? {
          computer: desktop.computer,
          listApps: desktop.listApps,
          getApp: desktop.getApp
        }
      : {})
  }
}
