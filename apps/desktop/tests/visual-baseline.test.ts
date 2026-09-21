import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const figmaScenes = [
  'home-default',
  'home-model-selecting',
  'task-split',
  'task-browser-expanded',
  'task-browser-collapsed',
  'task-model-selecting',
  'settings-populated',
  'settings-empty',
  'settings-menu-open',
  'settings-connection-form',
  'settings-models-untested',
  'settings-models-testing',
  'settings-models-partial-failure',
  'settings-models-success'
] as const

function pngDimensions(buffer: Buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

describe('Figma visual baselines', () => {
  it('keeps one 1440x900 acceptance capture for all 14 product frames', async () => {
    const actualDirectory = join(import.meta.dirname, '../../../design/actual')
    const dimensions = await Promise.all(
      figmaScenes.map(async (scene) => pngDimensions(await readFile(join(actualDirectory, `${scene}.png`))))
    )

    expect(figmaScenes).toHaveLength(14)
    expect(dimensions).toEqual(figmaScenes.map(() => ({ width: 1440, height: 900 })))
  })

  it('keeps the minimum-window evidence at 1024x700', async () => {
    const screenshot = await readFile(
      join(import.meta.dirname, '../../../design/actual/minimum-window.png')
    )
    expect(pngDimensions(screenshot)).toEqual({ width: 1024, height: 700 })
  })
})
