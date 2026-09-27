import { z } from 'zod'
import type { ImageAssetRef } from './tool.js'

const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const pathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) => path.split('.').every((segment) => segment.length > 0 && !forbidden.has(segment)),
    'Unsafe selector'
  )
const kindSchema = z.enum(['text', 'code', 'link', 'image'])
export const toolPresentationFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    path: pathSchema,
    kind: kindSchema,
    language: z.string().max(100).optional(),
    hideFalse: z.boolean().optional(),
    placement: z.literal('footer').optional()
  })
  .strict()
  .refine((field) => !field.placement || field.kind === 'text', 'Footer requires text status')
export const toolPresentationSchema = z
  .object({
    layout: z.literal('terminal').optional(),
    input: z.array(toolPresentationFieldSchema).max(100),
    output: z.array(toolPresentationFieldSchema).max(100)
  })
  .strict()
  .refine(
    (presentation) => presentation.input.every((field) => !field.placement),
    'Footer belongs to output'
  )
const assetSchema: z.ZodType<ImageAssetRef> = z
  .object({
    assetId: z.string().trim().min(1).max(200),
    sessionId: z.string().trim().min(1).max(200),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteLength: z.number().int().positive(),
    source: z.enum(['upload', 'generated'])
  })
  .strict()
function safeLink(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
export const toolDetailFieldSchema = z
  .object({
    label: z.string().min(1).max(500),
    kind: kindSchema,
    value: z.string(),
    language: z.string().max(100).optional(),
    asset: assetSchema.optional(),
    placement: z.literal('footer').optional()
  })
  .strict()
  .refine((field) => !field.placement || field.kind === 'text', 'Footer requires text status')
  .refine((field) => field.kind !== 'link' || safeLink(field.value), 'Unsafe URL')
  .refine(
    (field) => field.kind !== 'image' || Boolean(field.asset),
    'Image requires an existing asset'
  )
export const toolDetailsSchema = z
  .object({
    layout: z.literal('terminal').optional(),
    input: z.array(toolDetailFieldSchema),
    output: z.array(toolDetailFieldSchema),
    truncated: z.boolean().optional()
  })
  .strict()
  .refine((details) => details.input.every((field) => !field.placement), 'Footer belongs to output')
export type ToolPresentation = z.infer<typeof toolPresentationSchema>
export type ToolPresentationField = z.infer<typeof toolPresentationFieldSchema>
export type ToolDetailField = z.infer<typeof toolDetailFieldSchema>
export type ToolDetails = z.infer<typeof toolDetailsSchema>

/** Portable, bounded projection: objects never become JSON and selectors never traverse prototypes. */
export function projectToolDetails(
  presentation: ToolPresentation | undefined,
  input: unknown,
  output: unknown,
  options: { maxBytes?: number; maxFields?: number } = {}
): ToolDetails {
  const details: ToolDetails = { input: [], output: [] }
  const parsed = toolPresentationSchema.safeParse(presentation)
  if (!parsed.success) return details
  if (parsed.data.layout) details.layout = parsed.data.layout
  let remaining = Math.max(0, options.maxBytes ?? 64 * 1024)
  const maxFields = Math.max(0, options.maxFields ?? 100)
  let fields = 0
  let visited = 0
  const encoder = new TextEncoder()
  // Stop traversing once the display budget is full, including enormous wildcard arrays.
  function* select(
    value: unknown,
    segments: string[],
    indices: number[] = []
  ): Generator<{ value: unknown; indices: number[] }> {
    if (++visited > 10000) {
      details.truncated = true
      return
    }
    if (!segments.length) {
      yield { value, indices }
      return
    }
    const [segment, ...rest] = segments
    if (!value || typeof value !== 'object') return
    if (segment === '*') {
      if (!Array.isArray(value)) return
      for (let index = 0; index < value.length; index++) {
        if (++visited > 10000) {
          details.truncated = true
          return
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, index)
        if (descriptor && 'value' in descriptor)
          yield* select(descriptor.value, rest, [...indices, index + 1])
        if (
          index < value.length - 1 &&
          (fields >= maxFields || remaining <= 0 || visited >= 10000)
        ) {
          details.truncated = true
          return
        }
      }
    } else if (segment && !forbidden.has(segment) && Object.hasOwn(value, segment)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, segment)
      if (descriptor && 'value' in descriptor) yield* select(descriptor.value, rest, indices)
    }
  }
  for (const side of ['input', 'output'] as const) {
    for (const declaration of parsed.data[side]) {
      for (const selected of select(
        side === 'input' ? input : output,
        declaration.path.split('.')
      )) {
        const raw = selected.value
        if (raw === null || raw === undefined || (declaration.hideFalse && raw === false)) continue
        let field: ToolDetailField
        const label =
          declaration.label + (selected.indices.length ? ` ${selected.indices.join('.')}` : '')
        if (declaration.kind === 'image') {
          const asset = assetSchema.safeParse(raw)
          if (!asset.success) continue
          field = { label, kind: 'image', value: asset.data.assetId, asset: asset.data }
        } else {
          if (
            !['string', 'number', 'boolean'].includes(typeof raw) ||
            (typeof raw === 'number' && !Number.isFinite(raw))
          )
            continue
          const value = String(raw)
          if (!value.trim()) continue
          field = {
            label,
            kind: declaration.kind === 'link' && !safeLink(value) ? 'text' : declaration.kind,
            value,
            ...(declaration.language ? { language: declaration.language } : {})
          }
        }
        if (declaration.placement) field = { ...field, placement: declaration.placement }
        if (fields >= maxFields || remaining <= 0) {
          details.truncated = true
          break
        }
        const bytes = encoder.encode(field.value).length
        if (bytes > remaining) {
          details.truncated = true
          if (field.kind === 'image') {
            remaining = 0
            break
          }
          let value = '',
            used = 0
          for (const character of field.value) {
            const size = encoder.encode(character).length
            if (used + size > remaining) break
            value += character
            used += size
          }
          field = { ...field, value, ...(field.kind === 'link' ? { kind: 'text' as const } : {}) }
          remaining = 0
        } else remaining -= bytes
        if (field.value) {
          details[side].push(field)
          fields++
        }
      }
    }
  }
  return details
}
