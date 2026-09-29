// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { createBrowserConfig } from '../../src/service-config'
import { originalBrowserConfig } from '../original-service'
async function compare(exercise: (create: any) => Promise<unknown>) {
  expect(await exercise(createBrowserConfig)).toEqual(await exercise(await originalBrowserConfig()))
}
test('config shares pending reads, snapshots, refresh and five-minute expiry like original', async () => {
  await compare(async (create) => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const calls: unknown[] = [],
      data = { value: 1 }
    const config = create({
      cwd: '/cwd',
      config: {
        async readToml(path: string) {
          calls.push(path)
          return { ...data }
        },
        async read(input: any) {
          calls.push(input)
          return 'all'
        },
        async readRequirements() {
          return 'requirements'
        }
      }
    })
    try {
      const [first, second] = await Promise.all([
        config.global.readSnapshot(),
        config.global.readSnapshot()
      ])
      expect(first).toBe(second)
      data.value = 2
      const cached = await config.global.get('value')
      const refreshed = await config.global.get('value', { refresh: true })
      vi.setSystemTime(300000)
      const expired = await config.global.get('value')
      return {
        first,
        cached,
        refreshed,
        expired,
        calls,
        all: await config.readAll(),
        requirements: await config.readRequirements()
      }
    } finally {
      vi.useRealTimers()
    }
  })
})
test('config update merges state, serializes across wrappers sharing host and refreshes after writes', async () => {
  await compare(async (create) => {
    const calls: unknown[] = []
    let data: any = { a: 1 }
    const host = {
      cwd: '/',
      config: {
        async readToml(path: string) {
          calls.push(['read', path])
          return { ...data }
        },
        async writeToml(path: string, value: any) {
          calls.push(['write', path, value])
          data = { ...value }
        }
      }
    }
    const a = create(host),
      b = create(host)
    await Promise.all([a.global.set('b', 2), b.global.update((state: any) => ({ c: state.b + 1 }))])
    return { snapshot: await a.global.readSnapshot({ refresh: true }), calls }
  })
})
test('config session validation and malformed snapshots follow original', async () => {
  await compare(async (create) => {
    const config = create({ config: { readToml: async () => [] } })
    const errors = []
    for (const id of ['', '../x', 'a.b', 'x'.repeat(129), null])
      try {
        config.session(id)
      } catch (e: any) {
        errors.push(e.message)
      }
    return { errors, snapshot: await config.session('valid-1_').readSnapshot() }
  })
})
test('config failed reads evict cache and failed writes do not poison subsequent mutation queue', async () => {
  await compare(async (create) => {
    let failRead = true,
      failWrite = true
    const error = new Error('failure'),
      calls: unknown[] = []
    let data = { a: 1 }
    const config = create({
      config: {
        async readToml() {
          calls.push('read')
          if (failRead) {
            failRead = false
            throw error
          }
          return { ...data }
        },
        async writeToml(_path: string, value: any) {
          calls.push('write')
          if (failWrite) {
            failWrite = false
            throw error
          }
          data = value
        }
      }
    })
    try {
      await config.global.readSnapshot()
    } catch (e) {
      expect(e).toBe(error)
    }
    try {
      await config.global.set('a', 2)
    } catch (e) {
      expect(e).toBe(error)
    }
    await config.global.set('a', 3)
    return { data: await config.global.readSnapshot(), calls }
  })
})
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
test('older refresh cannot replace a newer completed snapshot', async () => {
  await compare(async (create) => {
    const old = deferred<any>(),
      fresh = deferred<any>()
    let count = 0
    const config = create({ config: { readToml: () => (++count === 1 ? old : fresh).promise } })
    const a = config.global.readSnapshot()
    const b = config.global.readSnapshot({ refresh: true })
    await Promise.resolve()
    fresh.resolve({ value: 2 })
    const latest = await b
    old.resolve({ value: 1 })
    return { latest, late: await a, cached: await config.global.readSnapshot(), count }
  })
})
test('older failed read yields a newer successful snapshot without evicting it', async () => {
  await compare(async (create) => {
    const old = deferred<any>(),
      fresh = deferred<any>()
    let count = 0
    const config = create({ config: { readToml: () => (++count === 1 ? old : fresh).promise } })
    const a = config.global.readSnapshot()
    const b = config.global.readSnapshot({ refresh: true })
    await Promise.resolve()
    fresh.resolve({ value: 2 })
    await b
    old.reject(new Error('old failure'))
    return { late: await a, cached: await config.global.readSnapshot(), count }
  })
})
test('post-write refresh failure is swallowed and next read retries', async () => {
  await compare(async (create) => {
    const calls: unknown[] = []
    let data = { value: 1 },
      fail = false
    const config = create({
      config: {
        async readToml() {
          calls.push('read')
          if (fail) {
            fail = false
            throw new Error('refresh')
          }
          return { ...data }
        },
        async writeToml(_path: string, value: any) {
          calls.push('write')
          data = value
          fail = true
        }
      }
    })
    await config.global.set('value', 2)
    return { value: await config.global.get('value'), calls }
  })
})
