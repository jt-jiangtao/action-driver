interface HandoffContext {
  clientInfo: {
    name: string
    type: string
    capabilities?: { tab?: Array<{ id: string }> }
  }
  runtime: {
    env: Record<string, string | undefined>
    requestMeta?: Record<string, unknown>
  }
  tabs: {
    get(id: number): Promise<unknown>
    mark(id: number, status: 'handoff'): Promise<unknown>
  }
}
function turnMetadata(context: HandoffContext): Record<string, unknown> | undefined {
  let value = context.runtime.requestMeta?.['x-codex-turn-metadata']
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
export async function requestManualAuthHandoff(
  params: { tab_id: string },
  context: HandoffContext
): Promise<Record<string, never>> {
  if (context.clientInfo.type !== 'cdp' ||
    context.clientInfo.capabilities?.tab?.some(({ id }) => id === 'browserAuth') !== true)
    throw Error(`Browser authentication handoff is unavailable for ${context.clientInfo.name}`)
  if (turnMetadata(context)?.browser_auth_client_unsupported === 'true')
    throw Error(
      'This ChatGPT client does not support cloud browser takeover. Do not claim the handoff succeeded. Continue without handing off if possible. If the user explicitly requested takeover or the task cannot continue without it, briefly tell them to update the ChatGPT app.'
    )
  const id = Number(params.tab_id)
  if (!Number.isSafeInteger(id) || id <= 0)
    throw Error('Expected a positive integer')
  await context.tabs.get(id)
  await context.tabs.mark(id, 'handoff')
  return {}
}
