import { spawn } from 'node:child_process'
import type { EventEmitter} from 'node:events';
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadInstructions, instructionsRoot } from './instructions.js'
import type { InstructionSet } from './instructions.js'
export interface LaunchPlan {
  executable: string
  env: NodeJS.ProcessEnv
}
function ownedServices(value: string | undefined, surfaces: Set<string>): Record<string, string> {
  if (!value) throw new Error('NODE_REPL_TRUSTED_SERVICES must name Action-Driver-owned service modules')
  let configured: unknown
  try { configured = JSON.parse(value) } catch { throw new Error('NODE_REPL_TRUSTED_SERVICES is invalid JSON') }
  if (!configured || typeof configured !== 'object' || Array.isArray(configured))
    throw new Error('NODE_REPL_TRUSTED_SERVICES must be a service map')
  const services: Record<string, string> = {}
  for (const [surface, key] of [['browser', 'browser'], ['computer', 'sky']] as const) {
    if (!surfaces.has(surface)) continue
    const module = (configured as Record<string, unknown>)[key]
    if (typeof module !== 'string') throw new Error(`Missing Action-Driver ${surface} service`)
    let path: string
    try { path = module.startsWith('file:') ? fileURLToPath(module) : module }
    catch { throw new Error(`Invalid Action-Driver ${surface} service path`) }
    if (!isAbsolute(path) || /(?:^|\/)Codex\.app\/|(?:^|\/)ChatGPT\.app\/|(?:^|\/)(?:back|vendor)\//u.test(path))
      throw new Error(`Action-Driver ${surface} service must use an owned absolute path`)
    services[key] = module
  }
  return services
}
export function createLaunchPlan(
  env: NodeJS.ProcessEnv,
  instructions: InstructionSet,
  readBanner: () => string
): LaunchPlan {
  const executable = env.CUA_REPL_NODE_REPL_PATH
  if (!executable || !isAbsolute(executable))
    throw new Error('CUA_REPL_NODE_REPL_PATH must name an absolute executable')
  const enabled = env.CUA_REPL_ENABLED_SURFACES
  if (enabled === undefined) throw new Error('CUA_REPL_ENABLED_SURFACES is required')
  const surfaces = new Set(
    enabled
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
  for (const surface of surfaces)
    if (surface !== 'browser' && surface !== 'computer')
      throw new Error(`unknown CUA_REPL_ENABLED_SURFACES surface=${surface}`)
  if (!surfaces.size) throw new Error('CUA_REPL_ENABLED_SURFACES must enable at least one surface')
  const services = ownedServices(env.NODE_REPL_TRUSTED_SERVICES, surfaces)
  const descriptions = [instructions.description]
  if (surfaces.has('browser')) {
    descriptions.push(instructions.browser)
  } else descriptions.push(instructions.browserDisabled)
  if (surfaces.has('computer')) {
    descriptions.push(instructions.computer)
  } else descriptions.push(instructions.computerDisabled)
  descriptions.push(instructions.output)
  const overrides = {
    server_instructions: instructions.server,
    tools: {
      js: {
        description: descriptions.join('\n\n'),
        field_descriptions: { code: instructions.code }
      },
      js_reset: { description: instructions.reset }
    }
  }
  return {
    executable,
    env: {
      ...env,
      CUA_REPL_ENABLED_SURFACES: [...surfaces].join(','),
      NODE_REPL_UNTRUSTED_ENV_ALLOWLIST: [
        env.NODE_REPL_UNTRUSTED_ENV_ALLOWLIST,
        'CUA_REPL_ENABLED_SURFACES',
        'CUA_REPL_BROWSER_ENV'
      ]
        .filter(Boolean)
        .join(','),
      NODE_REPL_TRUSTED_SERVICES: JSON.stringify(services),
      NODE_REPL_JS_BANNER: env.NODE_REPL_JS_BANNER ?? readBanner(),
      NODE_REPL_TOOL_OVERRIDES: JSON.stringify(overrides)
    }
  }
}
export interface LaunchChild extends EventEmitter {
  kill(signal?: NodeJS.Signals): boolean
}
export interface LaunchHost {
  process: {
    env: NodeJS.ProcessEnv
    platform: string
    pid: number
    exitCode: number | string | null | undefined
    on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
    off(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
    kill(pid: number, signal: NodeJS.Signals): unknown
  }
  spawn(
    executable: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; stdio: 'inherit' }
  ): LaunchChild
  loadInstructions(platform: string, browserEnvironment?: string): InstructionSet
  readBanner(): string
}
const nativeHost: LaunchHost = {
  process,
  spawn,
  loadInstructions,
  readBanner: () => readFileSync(new URL('banner.js', instructionsRoot), 'utf8')
}
export async function launch(host: LaunchHost = nativeHost): Promise<void> {
  const env = host.process.env
  // Preserve executable validation before resource loading.
  if (!env.CUA_REPL_NODE_REPL_PATH || !isAbsolute(env.CUA_REPL_NODE_REPL_PATH))
    throw new Error('CUA_REPL_NODE_REPL_PATH must name an absolute executable')
  if (host.process.platform !== 'darwin')
    throw new Error(`unsupported cua_repl platform=${host.process.platform}`)
  const plan = createLaunchPlan(
    env,
    host.loadInstructions(host.process.platform, env.CUA_REPL_BROWSER_ENV),
    host.readBanner
  )
  const child = host.spawn(plan.executable, [], { env: plan.env, stdio: 'inherit' })
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
  const forward = (signal: NodeJS.Signals) => {
    child.kill(signal)
  }
  for (const signal of signals) host.process.on(signal, forward)
  const [code, signal] = await once(child, 'close').finally(() => {
    for (const name of signals) host.process.off(name, forward)
  })
  if (signal) host.process.kill(host.process.pid, signal)
  else host.process.exitCode = code !== null && code >= 0 ? code : 1
}
