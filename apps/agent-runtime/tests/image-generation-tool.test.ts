import { describe, expect, it, vi } from 'vitest'
import type { ToolCall } from '@actiondriver/runtime-contracts'
import { createImageGenerationTool } from '../src/media/image-generation-tool'
import { createTokenPlanImageGenerationAdapter } from '../src/media/token-plan-image-generation-adapter'

const asset = (index: number) => ({
  assetId: `asset-${index}`,
  sessionId: 'session-1',
  mimeType: 'image/png' as const,
  width: 1,
  height: 1,
  byteLength: 20,
  source: 'generated' as const
})
const call = (prompts: string[]): ToolCall => ({
  callId: 'tool:task-1:0:0',
  providerCallId: 'provider-1',
  modelName: 'image_generate',
  arguments: { images: prompts.map((prompt) => ({ prompt })) }
})
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('image_generate', () => {
  it('stores three Token Plan images from a four-image batch without leaking provider URLs', async () => {
    const temporaryUrl = 'https://temporary-provider.example/private-image.png'
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVkAAAAASUVORK5CYII=',
      'base64'
    )
    let providerCalls = 0
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === temporaryUrl) return new Response(new Uint8Array(png))
      providerCalls += 1
      const prompt = (
        JSON.parse(String(init?.body)) as {
          input: { messages: Array<{ content: Array<{ text: string }> }> }
        }
      ).input.messages[0]!.content[0]!.text
      if (prompt === 'bad') return new Response('private failure', { status: 429 })
      return new Response(
        JSON.stringify({
          output: { choices: [{ message: { content: [{ image: temporaryUrl }] } }] }
        })
      )
    })
    const adapter = createTokenPlanImageGenerationAdapter({ fetch })
    const saveGenerated = vi.fn(async (_sessionId: string, bytes: Uint8Array) => {
      expect(bytes).toEqual(new Uint8Array(png))
      return asset(saveGenerated.mock.calls.length)
    })
    const tool = createImageGenerationTool({
      defaultModel: async () => ({ connectionId: 'token-plan', modelId: 'wan2.7-image' }),
      generate: ({ prompt }, signal) =>
        adapter.generate(
          {
            baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
            apiKey: 'secret',
            modelId: 'wan2.7-image',
            prompt
          },
          signal
        ),
      assets: { saveGenerated },
      sessionForTask: async () => 'session-1'
    })
    const events = []
    for await (const event of tool.executor.execute(call(['good-1', 'bad', 'good-2', 'good-3'])))
      events.push(event)
    expect(providerCalls).toBe(4)
    expect(saveGenerated).toHaveBeenCalledTimes(3)
    expect(events.filter((event) => event.kind === 'asset')).toHaveLength(3)
    expect(events.at(-1)).toMatchObject({ kind: 'result', output: { succeeded: 3, failed: 1 } })
    expect(JSON.stringify(events)).not.toContain(temporaryUrl)
    expect(JSON.stringify(events)).not.toContain('private failure')
  })
  it('starts four independent requests and yields assets in completion order', async () => {
    const jobs = Array.from({ length: 4 }, () => deferred<Uint8Array>())
    const generate = vi.fn(({ prompt }: { prompt: string }) => jobs[Number(prompt)]!.promise)
    const saveGenerated = vi.fn(async (_sessionId: string, bytes: Uint8Array) => asset(bytes[0]!))
    const tool = createImageGenerationTool({
      defaultModel: async () => ({ connectionId: 'c', modelId: 'image' }),
      generate,
      assets: { saveGenerated },
      sessionForTask: async () => 'session-1'
    })
    const iterator = tool.executor.execute(call(['0', '1', '2', '3']))[Symbol.asyncIterator]()
    const first = iterator.next()
    await tick()
    expect(generate).toHaveBeenCalledTimes(4)
    jobs[2]!.resolve(new Uint8Array([2]))
    expect((await first).value).toMatchObject({ kind: 'asset', index: 2, asset: asset(2) })
    const second = iterator.next()
    jobs[0]!.resolve(new Uint8Array([0]))
    expect((await second).value).toMatchObject({ kind: 'asset', index: 0 })
    const third = iterator.next()
    jobs[1]!.resolve(new Uint8Array([1]))
    await third
    const fourth = iterator.next()
    jobs[3]!.resolve(new Uint8Array([3]))
    await fourth
    expect((await iterator.next()).value).toMatchObject({
      kind: 'result',
      output: { succeeded: 4, failed: 0 }
    })
    expect(saveGenerated).toHaveBeenCalledTimes(4)
  })

  it('rejects a fifth item before network I/O', async () => {
    const generate = vi.fn()
    const tool = createImageGenerationTool({
      defaultModel: async () => ({ connectionId: 'c', modelId: 'm' }),
      generate,
      assets: { saveGenerated: vi.fn() },
      sessionForTask: async () => 's'
    })
    await expect(async () => {
      for await (const event of tool.executor.execute(call(['a', 'b', 'c', 'd', 'e']))) {
        expect(event).toBeDefined()
      }
    }).rejects.toThrow('IMAGE_COUNT_INVALID')
    expect(generate).not.toHaveBeenCalled()
  })

  it('preserves successful assets when a peer fails', async () => {
    const tool = createImageGenerationTool({
      defaultModel: async () => ({ connectionId: 'c', modelId: 'm' }),
      generate: async ({ prompt }) => {
        if (prompt === 'bad') throw new Error('secret endpoint')
        return new Uint8Array([1])
      },
      assets: { saveGenerated: async () => asset(1) },
      sessionForTask: async () => 'session-1'
    })
    const events = []
    for await (const event of tool.executor.execute(call(['good', 'bad']))) events.push(event)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'asset', index: 0 }))
    expect(events.at(-1)).toMatchObject({ kind: 'result', output: { succeeded: 1, failed: 1 } })
    expect(JSON.stringify(events)).not.toContain('secret endpoint')
  })

  it('fails the batch when all requests fail', async () => {
    const tool = createImageGenerationTool({
      defaultModel: async () => ({ connectionId: 'c', modelId: 'm' }),
      generate: async () => {
        throw new Error('failed')
      },
      assets: { saveGenerated: vi.fn() },
      sessionForTask: async () => 's'
    })
    await expect(async () => {
      for await (const event of tool.executor.execute(call(['x']))) {
        expect(event).toBeDefined()
      }
    }).rejects.toThrow('IMAGE_GENERATION_FAILED')
  })

  it('stops unfinished requests after cancellation without late assets', async () => {
    const jobs = [deferred<Uint8Array>(), deferred<Uint8Array>()]
    const controller = new AbortController()
    const saveGenerated = vi.fn(async () => asset(0))
    const tool = createImageGenerationTool({
      defaultModel: async () => ({ connectionId: 'c', modelId: 'm' }),
      generate: ({ prompt }) => jobs[Number(prompt)]!.promise,
      assets: { saveGenerated },
      sessionForTask: async () => 'session-1'
    })
    const stream = tool.executor.execute(call(['0', '1']), controller.signal)
    const iterator = stream[Symbol.asyncIterator]()
    const first = iterator.next()
    jobs[0]!.resolve(new Uint8Array([0]))
    expect((await first).value).toMatchObject({ kind: 'asset', index: 0 })
    controller.abort()
    jobs[1]!.resolve(new Uint8Array([1]))
    await expect(iterator.next()).rejects.toBeDefined()
    expect(saveGenerated).toHaveBeenCalledTimes(1)
  })
})
