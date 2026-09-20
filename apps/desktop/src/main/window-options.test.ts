import { describe, expect, it } from 'vitest'
import { createMainWindowOptions } from './window-options'

describe('createMainWindowOptions', () => {
  it('creates the 1440x900 isolated macOS window contract', () => {
    const options = createMainWindowOptions('/tmp/preload.js')

    expect(options.width).toBe(1440)
    expect(options.height).toBe(900)
    expect(options.useContentSize).toBe(true)
    expect(options.minWidth).toBe(1024)
    expect(options.minHeight).toBe(700)
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 17 })
    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })
})
