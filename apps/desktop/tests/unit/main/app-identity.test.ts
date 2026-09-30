import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyApplicationName, applyDockIcon, resolveDesktopIconPath } from '../../../src/main/app-identity'

describe('desktop brand resource', () => {
  it('composes the app icon from the canonical Action-Driver SVG without a border', () => {
    const iconSource = readFileSync(
      resolve('apps/desktop/resources/action-driver-app-icon.svg'),
      'utf8'
    )

    expect(iconSource).toContain('href="../../../design/assets/action-driver-logo.svg"')
    expect(iconSource).not.toContain('stroke=')
  })

  it('resolves a readable 512px square PNG from the compiled main directory', () => {
    const iconPath = resolveDesktopIconPath(resolve('apps/desktop/out/main'))
    const png = readFileSync(iconPath)

    expect(iconPath).toBe(resolve('apps/desktop/resources/action-driver.png'))
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(512)
    expect(png.readUInt32BE(20)).toBe(512)
  })
})

describe('Electron application identity', () => {
  it('sets the user-visible application name to Action-Driver', () => {
    const setName = vi.fn()

    applyApplicationName({ setName })

    expect(setName).toHaveBeenCalledWith('Action-Driver')
  })

  it('sets the Dock icon when the platform exposes Dock capabilities', () => {
    const setIcon = vi.fn()

    applyDockIcon({ dock: { setIcon } }, '/tmp/action-driver.png')

    expect(setIcon).toHaveBeenCalledWith('/tmp/action-driver.png')
  })

  it('does nothing when the platform has no Dock capabilities', () => {
    expect(() => applyDockIcon({}, '/tmp/action-driver.png')).not.toThrow()
  })
})
