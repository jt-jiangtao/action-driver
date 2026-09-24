import { isAbsolute, relative, resolve } from 'node:path'

export const PACKAGED_RENDERER_URL = 'actiondriver://renderer/index.html'

export function resolveRendererAssetPath(rendererDirectory: string, requestUrl: string): string | null {
  const url = new URL(requestUrl)
  if (url.protocol !== 'actiondriver:' || url.hostname !== 'renderer') return null
  let requestedPath: string
  try {
    requestedPath = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  const root = resolve(rendererDirectory)
  const file = resolve(root, requestedPath.replace(/^\/+/, '') || 'index.html')
  const child = relative(root, file)
  if (child.startsWith('..') || isAbsolute(child)) return null
  return file
}
