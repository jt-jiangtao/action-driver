import { readFile, readdir } from 'node:fs/promises'

export type DesktopEnvironment = 'codex-app' | 'training' | 'cloud' | 'orbit'
const valid = new Set<DesktopEnvironment>(['codex-app', 'training', 'cloud', 'orbit'])
const root = new URL('../resources/environment-docs/', import.meta.url)

function environmentRoot(environment: DesktopEnvironment): URL {
  if (!valid.has(environment)) throw new Error('BROWSER_DESKTOP_ENVIRONMENT_UNAVAILABLE')
  return new URL(`${environment}/`, root)
}

export async function readDesktopResource(environment: DesktopEnvironment, name: string): Promise<string> {
  if (environment === 'codex-app' && name === 'browserAuthSafetyPrecheck.md')
    throw new Error('BROWSER_AUTH_SAFETY_PRECHECK_UNAVAILABLE')
  if (!/^[\w-]+(?:\/[\w-]+)*\.(?:md|json)$/u.test(name))
    throw new Error('BROWSER_RESOURCE_PATH_INVALID')
  try { return await readFile(new URL(name, environmentRoot(environment)), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`BROWSER_RESOURCE_UNAVAILABLE: ${environment}/${name}`)
    throw error
  }
}

export async function listDesktopResources(environment: DesktopEnvironment): Promise<string[]> {
  const base = environmentRoot(environment)
  const walk = async (dir: URL, prefix: string): Promise<string[]> => {
    const output: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) output.push(...await walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`))
      else if (entry.isFile()) output.push(`${prefix}${entry.name}`)
    }
    return output
  }
  return (await walk(base, '')).sort()
}
