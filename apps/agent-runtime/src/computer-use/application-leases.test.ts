import { describe, expect, it } from 'vitest'
import { ApplicationLeases } from './application-leases'

describe('application leases held for a turn', () => {
  it('rejects another session and releases only when all owning turns finish', () => {
    const leases = new ApplicationLeases()
    leases.acquire('com.apple.Notes', { sessionId: 'one', taskId: 'a' })
    leases.acquire('com.apple.Notes', { sessionId: 'one', taskId: 'b' })
    expect(() => leases.acquire('com.apple.Notes', { sessionId: 'two', taskId: 'c' })).toThrow(
      'APP_BUSY'
    )
    leases.releaseTurn('a')
    expect(() => leases.acquire('com.apple.Notes', { sessionId: 'two', taskId: 'c' })).toThrow(
      'APP_BUSY'
    )
    leases.releaseTurn('b')
    expect(() => leases.acquire('com.apple.Notes', { sessionId: 'two', taskId: 'c' })).not.toThrow()
  })
  it('keeps unrelated applications and sessions when a session is disposed', () => {
    const leases = new ApplicationLeases()
    leases.acquire('Notes', { sessionId: 'one', taskId: 'a' })
    leases.acquire('Finder', { sessionId: 'two', taskId: 'b' })
    leases.releaseSession('one')
    leases.acquire('Notes', { sessionId: 'three', taskId: 'c' })
    expect(() => leases.acquire('Finder', { sessionId: 'three', taskId: 'c' })).toThrow('APP_BUSY')
  })
  it('does not allow a task identity to migrate into a different session', () => {
    const leases = new ApplicationLeases()
    leases.acquire('Notes', { sessionId: 'one', taskId: 'a' })
    expect(() => leases.acquire('Finder', { sessionId: 'two', taskId: 'a' })).toThrow(
      'INVALID_REQUEST'
    )
    leases.releaseTurn('a')
    expect(() => leases.acquire('Finder', { sessionId: 'two', taskId: 'a' })).not.toThrow()
  })
})
