import { UnreachableCaseError } from './core/unreachable-case-error.js'
export interface AppRecord {
  id: string
  name?: string
  windows?: unknown[] | undefined
  [key: string]: unknown
}
export interface ComputerDiscovery {
  target: string
  list_apps(): Promise<AppRecord[]>
}
export interface TabRecord {
  id: string
  [key: string]: unknown
}
export interface BrowserDiscovery {
  user?: { openTabs?(): Promise<TabRecord[]> }
  tabs: { list(): Promise<TabRecord[]> }
}
export interface BrowserRecord {
  id: string
  [key: string]: unknown
}
export interface BrowserProvider {
  list(): Promise<BrowserRecord[]>
  get(id: string): Promise<BrowserDiscovery>
}
export async function getApps(computer: ComputerDiscovery): Promise<AppRecord[]> {
  switch (computer.target) {
    case 'mac':
    case 'windows':
      return computer.list_apps()
    case 'linux':
      return (await computer.list_apps()).map(({ id, name, windows }) => ({
        id,
        displayName: name,
        isRunning: windows!.length > 0,
        windows
      }))
    default:
      throw new UnreachableCaseError(computer.target as never)
  }
}
export async function getBrowserTabs(browser: BrowserDiscovery): Promise<TabRecord[]> {
  let user: Promise<TabRecord[]> = Promise.resolve([])
  if (browser.user?.openTabs)
    user = browser.user.openTabs().catch((error) => {
      console.error(error)
      return []
    })
  const controlled = browser.tabs.list()
  const [userTabs, controlledTabs] = await Promise.all([user, controlled])
  const merged = new Map<string, TabRecord>()
  for (const tab of userTabs) merged.set(tab.id, tab)
  for (const tab of controlledTabs) merged.set(tab.id, tab)
  return [...merged.values()]
}
export async function getState({
  browsers,
  computer
}: {
  browsers?: BrowserProvider
  computer?: ComputerDiscovery
}): Promise<{
  apps: AppRecord[]
  browsers: Array<BrowserRecord & { tabs: TabRecord[] }>
  errors?: string[]
}> {
  const apps = computer ? getApps(computer) : Promise.resolve([])
  const browserState = (async () => {
    if (!browsers) return []
    return Promise.all(
      (await browsers.list()).map(async (browser) => ({
        ...browser,
        tabs: await getBrowserTabs(await browsers.get(browser.id))
      }))
    )
  })()
  const [appResult, browserResult] = await Promise.allSettled([apps, browserState])
  const errors: string[] = []
  for (const [name, result] of Object.entries({
    'Native apps': appResult,
    Browsers: browserResult
  }))
    if (result.status === 'rejected') errors.push(`${name}: ${String(result.reason)}`)
  return {
    apps: appResult.status === 'fulfilled' ? appResult.value : [],
    browsers: browserResult.status === 'fulfilled' ? browserResult.value : [],
    ...(errors.length ? { errors } : {})
  }
}
