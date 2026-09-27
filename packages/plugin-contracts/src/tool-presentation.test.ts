import { describe, expect, it } from 'vitest'
import { projectToolDetails, toolPresentationSchema, toolDetailsSchema } from './index'
describe('semantic tool details', () => {
  it('restricts footer placement to output text status fields', () => {
    for (const kind of ['image', 'link', 'code']) {
      expect(
        toolPresentationSchema.safeParse({
          input: [],
          output: [{ label: 'Status', path: 'status', kind, placement: 'footer' }]
        }).success
      ).toBe(false)
      expect(
        toolDetailsSchema.safeParse({
          input: [],
          output: [{ label: 'Status', kind, value: 'https://example.com', placement: 'footer' }]
        }).success
      ).toBe(false)
    }
    expect(
      toolPresentationSchema.safeParse({
        input: [{ label: 'Status', path: 'status', kind: 'text', placement: 'footer' }],
        output: []
      }).success
    ).toBe(false)
    expect(
      toolDetailsSchema.safeParse({
        input: [{ label: 'Status', kind: 'text', value: 'ready', placement: 'footer' }],
        output: []
      }).success
    ).toBe(false)
  })

  it('preserves a validated terminal layout hint in details', () => {
    const presentation = {
      layout: 'terminal' as const,
      input: [{ label: 'Script', path: 'code', kind: 'code' as const }],
      output: []
    }
    const details = projectToolDetails(presentation, { code: 'pwd' }, {})
    expect(details).toEqual({
      layout: 'terminal',
      input: [{ label: 'Script', kind: 'code', value: 'pwd' }],
      output: []
    })
    expect(toolDetailsSchema.safeParse(details).success).toBe(true)
    expect(projectToolDetails({ ...presentation, layout: 'html' } as never, {}, {})).toEqual({
      input: [],
      output: []
    })
  })

  it('preserves plugin-declared footer placement without label inference', () => {
    const presentation = {
      input: [],
      output: [
        { label: 'Status', path: 'exitCode', kind: 'text' as const, placement: 'footer' as const }
      ]
    }
    const projected = projectToolDetails(presentation, {}, { exitCode: 0 })
    expect(projected).toEqual({
      input: [],
      output: [{ label: 'Status', kind: 'text', value: '0', placement: 'footer' }]
    })
    expect(toolDetailsSchema.safeParse(projected).success).toBe(true)
  })

  it('selects only scalar values including zero and false, with indexed array labels', () => {
    const presentation = {
      input: [{ label: 'Name', path: 'items.*.name', kind: 'text' as const }],
      output: [
        { label: 'Code', path: 'code', kind: 'text' as const },
        { label: 'Flag', path: 'flag', kind: 'text' as const }
      ]
    }
    expect(
      projectToolDetails(
        presentation,
        { items: [{ name: 'a' }, { name: '' }, { name: {} }, { name: 'b' }] },
        { code: 0, flag: false }
      )
    ).toEqual({
      input: [
        { label: 'Name 1', kind: 'text', value: 'a' },
        { label: 'Name 4', kind: 'text', value: 'b' }
      ],
      output: [
        { label: 'Code', kind: 'text', value: '0' },
        { label: 'Flag', kind: 'text', value: 'false' }
      ]
    })
    expect(projectToolDetails(undefined, { secret: 'raw' }, {})).toEqual({ input: [], output: [] })
  })
  it('guards selectors and unsafe URLs and validates existing image assets', () => {
    expect(
      toolPresentationSchema.safeParse({
        input: [{ label: 'x', path: '__proto__.x', kind: 'text' }],
        output: []
      }).success
    ).toBe(false)
    const presentation = {
      input: [],
      output: [
        { label: 'URL', path: 'url', kind: 'link' as const },
        { label: 'Image', path: 'image', kind: 'image' as const }
      ]
    }
    expect(
      projectToolDetails(
        presentation,
        {},
        { url: 'javascript:alert(1)', image: { url: 'https://x' } }
      )
    ).toEqual({ input: [], output: [{ label: 'URL', kind: 'text', value: 'javascript:alert(1)' }] })
    const asset = {
      assetId: 'a',
      sessionId: 's',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      byteLength: 1,
      source: 'generated'
    }
    expect(
      toolDetailsSchema.safeParse(projectToolDetails(presentation, {}, { image: asset })).success
    ).toBe(true)
    expect(projectToolDetails(presentation, {}, { image: asset }).output[0]?.asset).toEqual(asset)
  })
  it('bounds empty wildcard traversal and never invokes array getters', () => {
    let reads = 0
    const items: unknown[] = []
    Object.defineProperty(items, '0', {
      get() {
        reads++
        return 'secret'
      }
    })
    const presentation = {
      input: [{ label: 'Item', path: 'items.*', kind: 'text' as const }],
      output: []
    }
    expect(projectToolDetails(presentation, { items }, {}).input).toEqual([])
    expect(reads).toBe(0)
    expect(projectToolDetails(presentation, { items: Array(20000).fill(null) }, {}).truncated).toBe(
      true
    )
  })
  it('enforces one UTF-8 budget and field cap, omitting explicit false flags', () => {
    const presentation = {
      input: [{ label: 'Text', path: 'text', kind: 'text' as const }],
      output: [
        { label: 'Flag', path: 'flag', kind: 'text' as const, hideFalse: true },
        { label: 'Text', path: 'text', kind: 'code' as const }
      ]
    }
    expect(
      projectToolDetails(
        presentation,
        { text: '你你你' },
        { text: 'more', flag: false },
        { maxBytes: 7 }
      )
    ).toEqual({
      input: [{ label: 'Text', kind: 'text', value: '你你' }],
      output: [],
      truncated: true
    })
    expect(
      projectToolDetails(presentation, { text: 'a' }, { text: 'b' }, { maxFields: 1 }).truncated
    ).toBe(true)
  })
})
