import { describe, expect, it } from 'vitest'
import { createDesktopApi } from './desktop-api'

describe('createDesktopApi', () => {
  it('only exposes serializable environment information', () => {
    const api = createDesktopApi('darwin', '0.1.0')

    expect(api.getEnvironment()).toEqual({ platform: 'darwin', version: '0.1.0' })
    expect(Object.keys(api)).toEqual(['getEnvironment'])
  })
})
