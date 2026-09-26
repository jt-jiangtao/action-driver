// Trusted-host-only loader. Model code lives in another, sandboxed process and receives
// JSON RPC results; it never receives this context, the native client or approval callbacks.
import vm from 'node:vm'
import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

const METHODS = new Set([
  'list_apps',
  'get_app_state',
  'click',
  'drag',
  'paste',
  'perform_secondary_action',
  'press_key',
  'scroll',
  'select_text',
  'set_value',
  'type_text'
])
const TELEMETRY = [
  'logComputerUseClientCreated',
  'logComputerUseApprovalRequested',
  'logComputerUseApprovalResolved',
  'logComputerUseToolCalled'
]

export async function createCodexSkyService(options) {
  if (!vm.SourceTextModule)
    throw new Error('ENGINE_UNAVAILABLE: trusted host requires VM module support')
  const root = await realpath(resolve(options.vendorRoot, '@oai/sky/dist'))
  const sourceRoot = resolve(root, 'project/cua/sky_js/src')
  const mac = resolve(sourceRoot, 'targets/mac')
  const cache = new Map()
  const calls = new AsyncLocalStorage()
  const activeCall = () => {
    const call = calls.getStore()
    if (!call) throw new Error('INVALID_REQUEST: trusted execution context is required')
    if (call.context.signal?.aborted) throw new Error('CANCELLED: sky call cancelled')
    return call
  }
  const nativeClient = options.approval
    ? new Proxy(options.nativeClient, {
        get(client, method) {
          if (method === 'getAppPolicy')
            return async (app) => {
              const call = activeCall()
              const policy = copyData(await options.approval.queryPolicy(app, call.context))
              activeCall()
              call.policy = policy
              const { bundleId, ...target } = policy.target
              return { ...policy, target: { ...target, bundleIdentifier: bundleId } }
            }
          const value = Reflect.get(client, method)
          if (typeof value !== 'function') return value
          return async (...args) => {
            const call = activeCall()
            await options.approval.beforeNativeCall?.(call.context, call.policy, method)
            activeCall()
            return await value.apply(client, [...args, call.context])
          }
        }
      })
    : options.nativeClient
  const createElicitation = options.approval
    ? async (input) => {
        const call = activeCall()
        if (!call.policy || input.meta?.tool_params?.app !== call.policy.target.bundleId) {
          throw new Error('INVALID_REQUEST: approval does not match the queried application')
        }
        await options.approval.requestApproval(call.context, call.policy, call.context.signal)
        activeCall()
        return { action: 'accept' }
      }
    : options.createElicitation
  const context = vm.createContext({
    Buffer,
    URL,
    performance,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    process: Object.freeze({
      platform: 'darwin',
      arch: process.arch,
      versions: process.versions,
      env: Object.freeze({}),
      cwd: () => root
    }),
    nodeRepl: Object.freeze({
      env: Object.freeze({}),
      requestMeta: options.requestMeta ?? {},
      createElicitation,
      withSuspendedTimeout: options.approval
        ? (operation) => options.withSuspendedTimeout(operation, activeCall().context)
        : options.withSuspendedTimeout,
      setResponseMeta: options.setResponseMeta ?? (() => {})
    })
  })

  function synthetic(values, name) {
    return new vm.SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value)
      },
      { context, identifier: name }
    )
  }

  async function get(specifier, from) {
    const key = specifier.startsWith('node:')
      ? specifier
      : await realpath(resolve(dirname(from), specifier))
    if (cache.has(key)) return await cache.get(key)
    const loading = (async () => {
      if (key.startsWith('node:')) return synthetic(await import(key), key)
      if (!key.startsWith(root + sep))
        throw new Error('INVALID_REQUEST: module outside fixed vendor root')
      if (key === resolve(mac, 'client.js')) return synthetic({ client: nativeClient }, key)
      if (key === resolve(mac, 'computer-use-telemetry.js')) {
        return synthetic(
          Object.fromEntries(
            TELEMETRY.map((name) => [name, (value) => options.onTelemetry?.(name, value)])
          ),
          key
        )
      }
      if (key === resolve(sourceRoot, 'load_options.js')) {
        return synthetic({ load_options: () => ({ target: 'mac' }) }, key)
      }
      return new vm.SourceTextModule(await readFile(key, 'utf8'), {
        context,
        identifier: key,
        importModuleDynamically: async (specifier, parent) => {
          const module = await get(specifier, parent.identifier)
          if (module.status === 'unlinked') await module.link((s, m) => get(s, m.identifier))
          if (module.status === 'linked') await module.evaluate()
          return module
        }
      })
    })()
    cache.set(key, loading)
    return await loading
  }

  const service = await get('./service.js', resolve(sourceRoot, 'entry.js'))
  await service.link((specifier, parent) => get(specifier, parent.identifier))
  await service.evaluate()
  return Object.freeze({
    async handleRpc(input, executionContext) {
      const request = copyData(input)
      if (!request || typeof request !== 'object' || Array.isArray(request))
        throw new Error('INVALID_REQUEST: invalid sky RPC')
      if (request.type === 'setup' && Object.keys(request).length === 1) {
        const result = await service.namespace.handleRpc(request)
        return { target: 'mac', methods: result.methods.filter((method) => METHODS.has(method)) }
      }
      if (
        request.type !== 'execute' ||
        Object.keys(request).some((key) => !['type', 'method', 'args'].includes(key)) ||
        !METHODS.has(request.method) ||
        !Array.isArray(request.args) ||
        request.args.length !== (request.method === 'list_apps' ? 0 : 1)
      ) {
        throw new Error('INVALID_REQUEST: unsupported sky RPC')
      }
      if (
        options.approval &&
        (!executionContext ||
          typeof executionContext.taskId !== 'string' ||
          !executionContext.taskId.trim() ||
          typeof executionContext.sessionId !== 'string' ||
          !executionContext.sessionId.trim())
      ) {
        throw new Error('INVALID_REQUEST: trusted execution context is required')
      }
      const context = executionContext
        ? Object.freeze({
            taskId: executionContext.taskId,
            sessionId: executionContext.sessionId,
            signal: executionContext.signal
          })
        : undefined
      const result = await calls.run({ context }, () => service.namespace.handleRpc(request))
      return result === undefined ? null : JSON.parse(JSON.stringify(result))
    }
  })
}

function copyData(value, ancestors = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value
  if (typeof value !== 'object' || ancestors.has(value))
    throw new Error('INVALID_REQUEST: expected JSON data')
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('INVALID_REQUEST: expected plain data')
  }
  ancestors.add(value)
  const result = Array.isArray(value) ? [] : Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !('value' in descriptor))
      throw new Error('INVALID_REQUEST: accessors are not permitted')
    Object.defineProperty(result, key, {
      value: copyData(descriptor.value, ancestors),
      enumerable: descriptor.enumerable
    })
  }
  ancestors.delete(value)
  return Object.freeze(result)
}
