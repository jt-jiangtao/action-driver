export interface NavigationGuardTarget {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  on(
    event: 'will-navigate',
    handler: (event: { preventDefault(): void }, url: string) => void
  ): void
}

export function resolveTrustedRendererOrigin(rendererEntryUrl: string): string | null {
  const rendererEntry = new URL(rendererEntryUrl)
  if (rendererEntry.protocol === 'actiondriver:' && rendererEntry.hostname === 'renderer') {
    return 'actiondriver://renderer'
  }
  return rendererEntry.protocol === 'http:' || rendererEntry.protocol === 'https:'
    ? rendererEntry.origin
    : null
}

export function installNavigationGuards(
  target: NavigationGuardTarget,
  rendererEntryUrl: string
): void {
  const rendererEntry = new URL(rendererEntryUrl)
  target.setWindowOpenHandler(() => ({ action: 'deny' }))
  target.on('will-navigate', (event, candidateUrl) => {
    const candidate = new URL(candidateUrl)
    const trustedOrigin = resolveTrustedRendererOrigin(rendererEntryUrl)
    const candidateOrigin = resolveTrustedRendererOrigin(candidateUrl)
    const allowed =
      rendererEntry.protocol === 'file:'
        ? candidate.href === rendererEntry.href
        : trustedOrigin !== null && candidateOrigin === trustedOrigin
    if (!allowed) event.preventDefault()
  })
}
