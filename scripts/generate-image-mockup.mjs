#!/usr/bin/env node
/**
 * Generates a design mockup through the Aliyun Model Studio (百炼) synchronous image API.
 *
 * Usage:
 *   ACTIONDRIVER_IMAGE_API_KEY=sk-... node scripts/generate-image-mockup.mjs \
 *     --prompt "..." --out design/actual/example.png [--model qwen-image-3.0-pro] [--size 1664*928]
 *
 * The API key is read from the environment and never logged or written to disk.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const apiKey = process.env.ACTIONDRIVER_IMAGE_API_KEY ?? process.env.DASHSCOPE_API_KEY
const baseUrl =
  process.env.ACTIONDRIVER_IMAGE_BASE_URL ?? 'https://token-plan.cn-beijing.maas.aliyuncs.com'
const model = args.model ?? 'qwen-image-3.0-pro'
const size = args.size ?? '1664*928'

if (!apiKey) throw new Error('ACTIONDRIVER_IMAGE_API_KEY (or DASHSCOPE_API_KEY) is required')
if (!args.prompt) throw new Error('--prompt is required')
if (!args.out) throw new Error('--out is required')

const response = await fetch(`${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model,
    input: {
      messages: [{ role: 'user', content: [{ text: args.prompt }] }]
    },
    parameters: {
      size,
      n: 1,
      ...(args.negativePrompt ? { negative_prompt: args.negativePrompt } : {}),
      ...(args.watermark === 'off' ? { watermark: false } : {})
    }
  })
})

const payload = await response.json()
if (!response.ok) {
  throw new Error(
    `image generation failed (${response.status}): ${JSON.stringify(payload).slice(0, 400)}`
  )
}

const imageUrl = extractImageUrl(payload)
if (!imageUrl) throw new Error(`no image url in response: ${JSON.stringify(payload).slice(0, 400)}`)

const download = await fetch(imageUrl)
if (!download.ok) throw new Error(`image download failed (${download.status})`)
const bytes = Buffer.from(await download.arrayBuffer())

const outPath = resolve(args.out)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, bytes)
console.log(`wrote ${outPath} (${bytes.length} bytes, model=${model}, size=${size})`)

function extractImageUrl(value) {
  const content = value?.output?.choices?.[0]?.message?.content
  if (!Array.isArray(content)) return null
  return content.find((item) => typeof item?.image === 'string')?.image ?? null
}

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) continue
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    result[name] = value
    index += 1
  }
  return result
}
