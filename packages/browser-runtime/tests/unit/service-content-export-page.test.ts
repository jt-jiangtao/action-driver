// @vitest-environment node
import { test, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { fetchGoogleExportPage, fetchYoutubeTranscriptPage, transcriptLimits } from '../../src/service-content-export-page'
import { originalDocumentation } from '../original-service'

test('serialized Google page request preserves bytes and HTTP failures', async () => {
  const base = await originalDocumentation()
  async function run(fetcher: any, status: number) {
    const dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://docs.google.com/document/d/id/edit',
      runScripts: 'outside-only'
    })
    const w = dom.window as any
    const calls: unknown[] = []
    w.fetch = async (url: string, options: unknown) => {
      calls.push([url, options])
      return {
        ok: status === 200,
        status,
        arrayBuffer: async () => Uint8Array.from([0, 127, 255]).buffer
      }
    }
    try {
      const expression = `(${fetcher.toString()})(${JSON.stringify({ exportUrl: 'https://docs.google.com/document/d/id/export?format=pdf' })})`
      let result, error
      try { result = await w.eval(expression) } catch (caught: any) { error = caught.message }
      return { result, error, calls }
    } finally { w.close() }
  }
  for (const status of [200, 403])
    expect(await run(fetchGoogleExportPage, status)).toEqual(
      await run(base.baselineGoogleExportPage, status)
    )
})

test('serialized YouTube caption capture observes current video, fetches bounded JSON and restores player state', async () => {
  const base = await originalDocumentation()
  async function run(fetcher: any, changed: boolean) {
    const dom = new JSDOM('<!doctype html><body><div id="movie_player"></div></body>', {
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      runScripts: 'outside-only'
    })
    const w = dom.window as any
    const calls: string[] = []
    let on = false
    const player = w.document.querySelector('#movie_player') as any
    player.getVideoData = () => ({ video_id: changed ? 'abcdefghijl' : 'abcdefghijk' })
    player.isSubtitlesOn = () => on
    player.toggleSubtitles = () => { calls.push('off'); on = false }
    player.toggleSubtitlesOn = () => { calls.push('on'); on = true }
    w.PerformanceObserver = class {
      callback: any
      constructor(callback: any) { this.callback = callback }
      observe() {
        calls.push('observe')
        this.callback({ getEntries: () => [{
          name: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr',
          startTime: w.performance.now()
        }] })
      }
      disconnect() { calls.push('disconnect') }
    }
    w.fetch = async (url: string, options: any) => {
      calls.push('fetch:' + url)
      expect(options.credentials).toBe('include')
      return {
        ok: true,
        headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
        body: null,
        text: async () => '{"events":[]}'
      }
    }
    try {
      const expression = `(${fetcher.toString()})(${JSON.stringify('abcdefghijk')},${JSON.stringify(transcriptLimits)})`
      return { result: await w.eval(expression), calls, restored: !on }
    } finally { w.close() }
  }
  for (const changed of [false, true])
    expect(await run(fetchYoutubeTranscriptPage, changed)).toEqual(
      await run(base.baselineYoutubeTranscriptPage, changed)
    )
})
