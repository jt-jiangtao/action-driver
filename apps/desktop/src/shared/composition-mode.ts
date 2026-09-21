export type DesktopCompositionMode = 'mock' | 'local'

export function resolveDesktopCompositionMode(buildMode: string): DesktopCompositionMode {
  return buildMode === 'test' || buildMode === 'visual' ? 'mock' : 'local'
}
