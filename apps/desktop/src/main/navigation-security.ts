export interface NavigationGuardTarget {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  on(
    event: 'will-navigate',
    handler: (event: { preventDefault(): void }, url: string) => void
  ): void
}

export function installNavigationGuards(
  target: NavigationGuardTarget,
  rendererEntryUrl: string
): void {
  const rendererEntry = new URL(rendererEntryUrl)
  target.setWindowOpenHandler(() => ({ action: 'deny' }))
  target.on('will-navigate', (event, candidateUrl) => {
    const candidate = new URL(candidateUrl)
    const allowed =
      rendererEntry.protocol === 'file:'
        ? candidate.href === rendererEntry.href
        : candidate.origin === rendererEntry.origin
    if (!allowed) event.preventDefault()
  })
}
