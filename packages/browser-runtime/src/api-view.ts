import { isPlainObject } from './utilities.js'

export interface ApiManifest {
  interfaces: Record<string, Record<string, { unsupportedByDefaultIn?: string[] }>>
}
type RuntimeConstructor = abstract new (...args: never[]) => object
interface ViewOptions {
  tabType?: RuntimeConstructor
  decorateTab?: (tab: object) => void
}
/** Builds visibility views; runtime setup and the complete class registry remain separate. */
export function createApiView(
  manifest: ApiManifest,
  runtimeTypes: Record<string, unknown>,
  options: ViewOptions = {}
) {
  const originals = new WeakMap<object, object>()
  const types = Object.keys(manifest.interfaces).map((name) => {
    const type = Reflect.get(runtimeTypes, name)
    if (typeof type !== 'function' || type.prototype == null) {
      throw new Error(`Browser API interface has no runtime type: ${name}`)
    }
    return [type as RuntimeConstructor, name] as const
  })
  return <T>(value: T, disabledMemberIds: Set<string>): T => {
    const views = new WeakMap<object, object>()
    const unwrap = (value: unknown): unknown => {
      if (value == null || typeof value !== 'object') return value
      const original = originals.get(value)
      if (original) return original
      if (Array.isArray(value)) return value.map(unwrap)
      if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrap(item)]))
      }
      return value
    }
    const wrap = (value: unknown): unknown => {
      if (value == null || typeof value !== 'object' || originals.has(value)) return value
      if (value instanceof Promise) return value.then(wrap)
      if (Array.isArray(value)) return value.map(wrap)
      const name = types.find(([type]) => value instanceof type)?.[1]
      if (name == null) return value
      const cached = views.get(value)
      if (cached) return cached
      const visible = (key: string | symbol) =>
        typeof key !== 'string' || !disabledMemberIds.has(`${name}.${key}`)
      const methods = new Map<string | symbol, (...args: unknown[]) => unknown>()
      const view = new Proxy(value, {
        get(target, key) {
          if (!visible(key)) return
          const member = Reflect.get(target, key, target)
          if (key === 'constructor') return member
          if (typeof member !== 'function') return wrap(member)
          const cachedMethod = methods.get(key)
          if (cachedMethod) return cachedMethod
          const bound = (...args: unknown[]) =>
            wrap(Reflect.apply(member, target, args.map(unwrap)))
          methods.set(key, bound)
          return bound
        },
        getOwnPropertyDescriptor(target, key) {
          if (!visible(key)) return
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
          return descriptor && 'value' in descriptor
            ? { ...descriptor, value: wrap(descriptor.value) }
            : descriptor
        },
        has: (target, key) => visible(key) && Reflect.has(target, key),
        ownKeys: (target) => Reflect.ownKeys(target).filter(visible)
      })
      views.set(value, view)
      originals.set(view, value)
      if (options.tabType && view instanceof options.tabType) options.decorateTab?.(view)
      return view
    }
    return wrap(value) as T
  }
}

export function disabledMembersForBrowser(
  manifest: ApiManifest,
  browserInfo: { type: string; apiSupportOverrides?: Record<string, boolean | null | undefined> | undefined },
  disabledMemberIds: Set<string>
): Set<string> {
  const disabled = new Set(disabledMemberIds)
  for (const [interfaceName, members] of Object.entries(manifest.interfaces)) {
    for (const [memberName, member] of Object.entries(members)) {
      const id = `${interfaceName}.${memberName}`
      const supported =
        browserInfo.apiSupportOverrides?.[id] ??
        member.unsupportedByDefaultIn?.includes(browserInfo.type) !== true
      if (!supported) disabled.add(id)
    }
  }
  return disabled
}
