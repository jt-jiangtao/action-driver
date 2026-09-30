import type { SkyProxy } from './sky-proxy.js'

// Retain the legacy entry shape, but require callers to supply an owned host
// through createProductSky instead of connecting to a private service.
export const sky = new Proxy({} as SkyProxy, {
  get() { throw new Error('SKY_HOST_UNAVAILABLE') },
  has() { throw new Error('SKY_HOST_UNAVAILABLE') },
  ownKeys() { throw new Error('SKY_HOST_UNAVAILABLE') }
})
