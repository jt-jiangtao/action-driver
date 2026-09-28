// @vitest-environment node
import { expect, test } from 'vitest'
import * as candidate from '../src/commands/index'
import { originalClient } from './original-client'
const { baselineApi } = await originalClient()
function sample(schema: any): any {
  const d = schema._def
  switch (d.typeName) {
    case 'ZodObject':
      return Object.fromEntries(
        Object.entries(d.shape()).map(([key, value]) => [key, sample(value)])
      )
    case 'ZodString':
      return d.checks.some((c: any) => c.kind === 'url')
        ? 'https://example.test'
        : d.checks.some((c: any) => c.kind === 'datetime')
          ? '2026-09-28T00:00:00.000Z'
          : 'sample'
    case 'ZodNumber':
      return d.checks.find((c: any) => c.kind === 'min')?.value ?? 1
    case 'ZodBoolean':
      return false
    case 'ZodUnknown':
      return { value: 1 }
    case 'ZodEnum':
      return d.values[0]
    case 'ZodLiteral':
      return d.value
    case 'ZodArray':
      return Array.from({ length: d.minLength?.value ?? 0 }, () => sample(d.type))
    case 'ZodOptional':
      return undefined
    case 'ZodNullable':
      return null
    case 'ZodRecord':
      return {}
    case 'ZodUnion':
      return sample(d.options[0])
    case 'ZodDiscriminatedUnion':
      return sample(d.options[0])
    case 'ZodTuple':
      return d.items.map(sample)
    case 'ZodEffects': {
      const value = sample(d.schema)
      if ('mime_type' in value) value.text = 'sample'
      else value.value = 'sample'
      return value
    }
    default:
      throw new Error(`unhandled fixture schema ${d.typeName}`)
  }
}
function parsed(schema: any, input: any) {
  try {
    return { value: schema.parse(input) }
  } catch (error: any) {
    return { issues: error.issues, message: error.message }
  }
}
for (const [name, ref] of Object.entries(baselineApi.Commands) as Array<[string, any]>)
  if (ref.PayloadSchema)
    test(`${name}: full schema contract and serialization match original`, () => {
      const own = (candidate.Commands as any)[name]
      expect(own).toBeDefined()
      expect(Object.keys(own).sort()).toEqual(Object.keys(ref).sort())
      expect(own.commandType).toBe(ref.commandType)
      for (const key of Object.keys(ref).filter((key) => key.endsWith('Schema'))) {
        const valid = sample(ref[key])
        expect(ref[key].safeParse(valid).success, `${name}.${key} fixture`).toBe(true)
        for (const value of [
          valid,
          null,
          {},
          [],
          1,
          false,
          { ...valid, extra: 'passthrough-test' }
        ])
          expect(parsed(own[key], value), `${name}.${key}`).toEqual(parsed(ref[key], value))
      }
      const payload = sample(ref.PayloadSchema)
      expect(own.create(payload).toJSON()).toEqual(ref.create(payload).toJSON())
      expect(own.create(payload).parse()).toEqual(ref.create(payload).parse())
    })
test('selection and clipboard custom validation preserves issue paths and exact messages', () => {
  for (const [name, payload] of [
    [
      'PlaywrightLocatorSelectOption',
      { browser_id: 'b', tab_id: 't', selector: '#x', selections: [{}, { index: -1 }] }
    ],
    [
      'TabClipboardWrite',
      {
        browser_id: 'b',
        tab_id: 't',
        items: [{ entries: [{ mime_type: 'x' }, { mime_type: 'x', text: 'x', base64: 'eA==' }] }]
      }
    ]
  ])
    expect(parsed((candidate.Commands as any)[name as string].PayloadSchema, payload)).toEqual(
      parsed(baselineApi.Commands[name as string].PayloadSchema, payload)
    )
})

for (const [name, ref] of Object.entries(baselineApi.Commands) as Array<[string, any]>)
  if (ref.PayloadSchema?._def.typeName === 'ZodObject')
    test(`${name}: individual field boundary errors match original`, () => {
      const own = (candidate.Commands as any)[name].PayloadSchema
      const baseline = ref.PayloadSchema
      const valid = sample(baseline)
      for (const key of Object.keys(valid))
        for (const input of [
          Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key)),
          { ...valid, [key]: null },
          { ...valid, [key]: [] },
          { ...valid, [key]: Number.NaN }
        ])
          expect(parsed(own, input), `${name}.${key}`).toEqual(parsed(baseline, input))
    })
