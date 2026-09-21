export class PersistencePayloadError extends Error {
  readonly code = 'PERSISTENCE_PAYLOAD_REJECTED'

  constructor(path: string, reason: string) {
    super(`PERSISTENCE_PAYLOAD_REJECTED at ${path}: ${reason}`)
    this.name = 'PersistencePayloadError'
  }
}

export function assertPersistablePayload(value: unknown, rootPath = 'payload'): void {
  const ancestors = new WeakSet<object>()

  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate))
        throw new PersistencePayloadError(path, 'number must be finite')
      return
    }
    if (typeof candidate !== 'object') {
      throw new PersistencePayloadError(path, `unsupported ${typeof candidate} value`)
    }
    if (ancestors.has(candidate)) throw new PersistencePayloadError(path, 'cyclic reference')
    ancestors.add(candidate)

    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`))
      ancestors.delete(candidate)
      return
    }

    const prototype = Object.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PersistencePayloadError(path, 'DOM, Electron, and other live objects are forbidden')
    }

    const record = candidate as Record<string, unknown>
    if (typeof record.x === 'number' && typeof record.y === 'number') {
      throw new PersistencePayloadError(path, 'coordinate references are forbidden')
    }

    for (const [key, nested] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase().replaceAll(/[-_]/g, '')
      if (normalizedKey.endsWith('handle')) {
        throw new PersistencePayloadError(`${path}.${key}`, 'live handles are forbidden')
      }
      if (['cookie', 'cookies', 'sessiontoken', 'sessiontokens'].includes(normalizedKey)) {
        throw new PersistencePayloadError(`${path}.${key}`, 'raw authentication data is forbidden')
      }
      visit(nested, `${path}.${key}`)
    }
    ancestors.delete(candidate)
  }

  visit(value, rootPath)
}
