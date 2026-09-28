export interface EnabledSurfaces {
  browser: boolean
  computer: boolean
}
export interface GlobalCUARuntime {
  getState: (...args: never[]) => unknown
}
/** Registration boundary only; the default macOS runtime factory is still separate. */
export async function registerCUAGlobal<Runtime extends GlobalCUARuntime>(
  createRuntime: (surfaces: EnabledSurfaces) => Runtime | Promise<Runtime>,
  env: Record<string, string | undefined>
): Promise<void> {
  const value = env.CUA_REPL_ENABLED_SURFACES
  if (value === undefined) throw new Error('CUA_REPL_ENABLED_SURFACES is required')
  const enabled = new Set(
    value
      .split(',')
      .map((surface) => surface.trim())
      .filter(Boolean)
  )
  if (enabled.size === 0) {
    throw new Error('CUA_REPL_ENABLED_SURFACES must enable at least one surface')
  }
  for (const surface of enabled) {
    if (surface !== 'browser' && surface !== 'computer') {
      throw new Error(`unknown CUA_REPL_ENABLED_SURFACES surface=${surface}`)
    }
  }
  const runtime = await createRuntime({
    browser: enabled.has('browser'),
    computer: enabled.has('computer')
  })
  Object.assign(runtime, { initialize: runtime.getState })
  Reflect.set(globalThis, 'cua', runtime)
}
