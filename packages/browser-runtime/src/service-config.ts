export type ConfigSnapshot = Record<string, unknown>
export interface BrowserConfigHost {
  cwd?: string | undefined
  config: {
    readToml(path: string): Promise<unknown>
    writeToml(path: string, value: ConfigSnapshot): Promise<unknown>
    read(options: { cwd: string | undefined; includeLayers: false }): Promise<unknown>
    readRequirements(): Promise<unknown>
  }
}
interface SnapshotEntry {
  generation: number
  invalidatedAt: number
  snapshot?: { value: ConfigSnapshot; expiresAt: number; generation: number }
  pending?: Promise<ConfigSnapshot>
}
export interface ConfigStore {
  get(key: string, options?: { refresh?: boolean }): Promise<unknown>
  readSnapshot(options?: { refresh?: boolean }): Promise<ConfigSnapshot>
  set(key: string, value: unknown): Promise<void>
  update(change: (snapshot: ConfigSnapshot) => ConfigSnapshot): Promise<void>
}
const mutationQueues = new WeakMap<BrowserConfigHost['config'], Map<string, Promise<void>>>()
function enqueue(host: BrowserConfigHost, path: string, run: () => Promise<void>): Promise<void> {
  let queues = mutationQueues.get(host.config)
  if (!queues) {
    queues = new Map()
    mutationQueues.set(host.config, queues)
  }
  const pending = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(run)
  queues.set(path, pending)
  const cleanup = () => {
    if (queues.get(path) === pending) queues.delete(path)
  }
  pending.then(cleanup, cleanup)
  return pending
}
export function createBrowserConfig(host: BrowserConfigHost) {
  const entries = new Map<string, SnapshotEntry>()
  function entry(path: string) {
    let value = entries.get(path)
    if (!value) {
      value = { generation: 0, invalidatedAt: 0 }
      entries.set(path, value)
    }
    return value
  }
  function read(path: string, refresh = false): Promise<ConfigSnapshot> {
    const state = entry(path)
    if (!refresh && state.snapshot && Date.now() < state.snapshot.expiresAt)
      return Promise.resolve(state.snapshot.value)
    if (!refresh && state.pending) return state.pending
    const generation = ++state.generation
    const recover = (): Promise<ConfigSnapshot> =>
      entries.get(path) !== state
        ? read(path, true)
        : state.snapshot
          ? Promise.resolve(state.snapshot.value)
          : (state.pending ?? read(path, true))
    const pending = Promise.resolve()
      .then(() => host.config.readToml(path))
      .then(
        (value) => {
          if (entries.get(path) !== state || state.invalidatedAt > generation) return recover()
          if (state.snapshot && state.snapshot.generation > generation) return state.snapshot.value
          const snapshot =
            typeof value === 'object' && value !== null && !Array.isArray(value)
              ? (value as ConfigSnapshot)
              : {}
          state.snapshot = { value: snapshot, expiresAt: Date.now() + 300000, generation }
          return snapshot
        },
        (error) => {
          if (entries.get(path) !== state || state.invalidatedAt > generation) return recover()
          if (state.snapshot && state.snapshot.generation > generation) return state.snapshot.value
          if (state.generation !== generation && state.pending) return state.pending
          entries.delete(path)
          throw error
        }
      )
      .finally(() => {
        if (state.pending === pending) delete state.pending
      })
    state.pending = pending
    return pending
  }
  function store(path: string): ConfigStore {
    return {
      async get(key, options) {
        return (await read(path, options?.refresh))[key]
      },
      readSnapshot(options) {
        return read(path, options?.refresh)
      },
      async set(key, value) {
        await this.update((snapshot) => ({ ...snapshot, [key]: value }))
      },
      async update(change) {
        await enqueue(host, path, async () => {
          const snapshot = await read(path, true),
            changes = change(snapshot),
            merged = { ...snapshot, ...changes },
            state = entry(path)
          state.invalidatedAt = ++state.generation
          delete state.snapshot
          delete state.pending
          await host.config.writeToml(path, merged)
          await read(path, true).catch(() => {})
        })
      }
    }
  }
  return {
    global: store('browser/config.toml'),
    async readAll() {
      return await host.config.read({ cwd: host.cwd, includeLayers: false })
    },
    async readRequirements() {
      return await host.config.readRequirements()
    },
    session(id: string) {
      if (
        typeof id !== 'string' ||
        id.length === 0 ||
        id.length > 128 ||
        !/^[A-Za-z0-9_-]+$/u.test(id)
      )
        throw new Error('Browser-use session id is invalid')
      return store(`browser/sessions/${id}.toml`)
    }
  }
}
