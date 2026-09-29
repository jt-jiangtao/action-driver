import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useObjectUrl } from '../../../../../src/renderer/src/hooks/use-object-url'

let created = 0
const revoked: string[] = []
const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }

// jsdom has no object URLs, so the test supplies them.
beforeEach(() => {
  created = 0
  revoked.length = 0
  URL.createObjectURL = vi.fn(() => `blob:url-${++created}`)
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
})
afterEach(() => {
  cleanup()
  URL.createObjectURL = original.create
  URL.revokeObjectURL = original.revoke
})

describe('useObjectUrl', () => {
  it('turns the loaded blob into an object URL', async () => {
    const load = async () => new Blob(['a'])
    const { result } = renderHook(() => useObjectUrl(load))
    expect(result.current).toEqual({ url: null, error: false })
    await waitFor(() => expect(result.current.url).toBe('blob:url-1'))
    expect(result.current.error).toBe(false)
  })

  it('reports a failed load', async () => {
    const load = async () => Promise.reject(new Error('x'))
    const { result } = renderHook(() => useObjectUrl(load))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.url).toBeNull()
  })

  it('reports an error when there is nothing to load', () => {
    const { result } = renderHook(() => useObjectUrl(null))
    expect(result.current).toEqual({ url: null, error: true })
  })

  it('revokes the previous URL when the source changes and on unmount', async () => {
    const first = async () => new Blob(['a'])
    const second = async () => new Blob(['b'])
    const view = renderHook(({ load }) => useObjectUrl(load), { initialProps: { load: first } })
    await waitFor(() => expect(view.result.current.url).toBe('blob:url-1'))

    view.rerender({ load: second })
    await waitFor(() => expect(view.result.current.url).toBe('blob:url-2'))
    expect(revoked).toEqual(['blob:url-1'])

    view.unmount()
    expect(revoked).toEqual(['blob:url-1', 'blob:url-2'])
  })
})
