export const transcriptLimits = {
  fetchTimeoutMs: 8000,
  maxItems: 5000,
  maxJsonBytes: 5 * 1024 * 1024,
  maxTextBytes: 500000,
  observationTimeoutMs: 4000
} as const

/** Runs in the page realm so the user's Google session can perform its own export request. */
export async function fetchGoogleExportPage({ exportUrl }: { exportUrl: string }) {
  const response = await fetch(exportUrl, { method: 'GET' })
  if (!response.ok)
    throw new Error('GSuite export request failed with HTTP ' + response.status)
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return { base64: btoa(binary) }
}

/** Reads only an observed captions request for the current video and restores player state. */
export async function fetchYoutubeTranscriptPage(
  videoId: string,
  limits: {
    fetchTimeoutMs: number
    maxJsonBytes: number
    observationTimeoutMs: number
  }
) {
  const call = (target: object, name: string) => {
    const method = Reflect.get(target, name)
    return typeof method === 'function' ? Reflect.apply(method, target, []) : undefined
  }
  const player = () => {
    const host = document.querySelector('ytd-player')
    const getPlayer = host == null ? null : Reflect.get(host, 'getPlayer')
    if (typeof getPlayer === 'function' && host != null) {
      const value = Reflect.apply(getPlayer, host, [])
      if (value != null && typeof value === 'object') return value
    }
    return document.querySelector('#movie_player')
  }
  const identity = () => {
    const current = player()
    let url: URL
    try { url = new URL(location.href) } catch {
      return { player: current, playerVideoId: null, urlVideoId: null }
    }
    const data = current == null ? null : call(current, 'getVideoData')
    const id = data != null && typeof data === 'object' ? Reflect.get(data, 'video_id') : null
    return {
      player: current,
      playerVideoId: typeof id === 'string' ? id : null,
      urlVideoId: url.searchParams.get('v')
    }
  }
  const isCurrent = (value: ReturnType<typeof identity>) =>
    value.player != null && value.playerVideoId === videoId && value.urlVideoId === videoId
  const initial = identity()
  if (!isCurrent(initial)) return null
  const selected = initial.player!
  if (
    ['getVideoData', 'isSubtitlesOn', 'toggleSubtitles', 'toggleSubtitlesOn'].some(
      (name) => typeof Reflect.get(selected, name) !== 'function'
    )
  ) return null
  const startedAt = performance.now()
  let captionsUrl: string | null = null
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.startTime + 0.5 < startedAt) continue
      try {
        const url = new URL(entry.name)
        if (
          url.protocol === 'https:' &&
          url.hostname === 'www.youtube.com' &&
          url.pathname === '/api/timedtext' &&
          url.searchParams.get('v') === videoId
        ) captionsUrl = entry.name
      } catch {}
    }
  })
  observer.observe({ buffered: true, type: 'resource' })
  const wasOn = Boolean(call(selected, 'isSubtitlesOn'))
  try {
    if (wasOn) call(selected, 'toggleSubtitles')
    call(selected, 'toggleSubtitlesOn')
    const until = Date.now() + limits.observationTimeoutMs
    while (Date.now() < until && captionsUrl === null)
      await new Promise((resolve) => setTimeout(resolve, 150))
  } finally {
    try {
      const latest = identity()
      if (isCurrent(latest) && latest.player === selected) {
        const isOn = Boolean(call(selected, 'isSubtitlesOn'))
        if (wasOn && !isOn) call(selected, 'toggleSubtitlesOn')
        else if (!wasOn && isOn) call(selected, 'toggleSubtitles')
      }
    } finally { observer.disconnect() }
  }
  if (captionsUrl === null || !isCurrent(identity())) return null
  const url = new URL(captionsUrl)
  url.searchParams.set('fmt', 'json3')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), limits.fetchTimeoutMs)
  try {
    const response = await fetch(url.toString(), {
      credentials: 'include',
      signal: controller.signal
    })
    if (
      !response.ok ||
      !response.headers.get('content-type')?.toLowerCase().includes('application/json')
    ) return null
    const declared = Number(response.headers.get('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > limits.maxJsonBytes) {
      controller.abort()
      return null
    }
    const reader = response.body?.getReader()
    let body: string
    if (reader == null) {
      body = await response.text()
      if (new TextEncoder().encode(body).byteLength > limits.maxJsonBytes) return null
    } else {
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value != null) {
          length += value.byteLength
          if (length > limits.maxJsonBytes) {
            await reader.cancel()
            return null
          }
          chunks.push(new Uint8Array(value))
        }
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      body = new TextDecoder().decode(bytes)
    }
    return isCurrent(identity())
      ? {
          body,
          captionKind: url.searchParams.get('kind'),
          captionLanguage: url.searchParams.get('lang'),
          pageUrl: location.href
        }
      : null
  } catch { return null }
  finally { clearTimeout(timeout) }
}
