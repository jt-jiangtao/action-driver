// @vitest-environment node
import { expect, test } from 'vitest'
import { originalDocumentation } from '../original-service'
import {
  validateAuthSelectors,
  isQrOnlyAuth,
  planCredentialFields,
  mapAuthOptions,
  validateSubmittedFields,
  selectedOptionAcceptsFields
} from '../../src/service-auth-validation'

test('auth selectors reject duplicate fields, colliding option selectors and unknown option fields', async () => {
  const original = await originalDocumentation()
  const base = { fields: [{ id: 'user', selector: '#user' }, { id: 'pass', selector: '#pass' }] }
  const cases = [
    base,
    { fields: [...base.fields, { id: 'user', selector: '#other' }] },
    { ...base, options: [{ id: 'choice', selector: '#user' }] },
    { ...base, options: [{ id: 'choice', field_ids: ['missing'] }] },
    { ...base, submit: { action: 'click', selector: '#user' } }
  ]
  expect(cases.map(validateAuthSelectors)).toEqual(cases.map(original.baselineAuthSelectors))
  expect(cases.map(validateAuthSelectors)).toEqual([true, false, false, false, false])
})

test('QR-only classification excludes mixed form and option requests', async () => {
  const original = await originalDocumentation()
  const cases = [
    { qr_code: true, fields: [] },
    { qr_code: true, fields: [{ id: 'x' }] },
    { qr_code: true, fields: [], options: [] },
    { qr_code: false, fields: [] }
  ]
  expect(cases.map(isQrOnlyAuth)).toEqual(cases.map(original.baselineQrOnlyAuth))
  expect(cases.map(isQrOnlyAuth)).toEqual([true, false, false, false])
})

test('OTP fields become one required prompt and options must cover whole grouped field', async () => {
  const original = await originalDocumentation()
  const fields = Array.from({ length: 4 }, (_, i) => ({
    id: `digit${i}`,
    label: `Digit ${i}`,
    type: 'text',
    required: true,
    autocomplete: 'one-time-code',
    labelMetadata: { accessible_name: `Digit ${i}`, autocomplete: 'one-time-code', input_type: 'text', input_mode: 'numeric', input_name: `digit${i}` }
  }))
  const ours = planCredentialFields(fields)
  expect(ours).toEqual(original.baselineAuthFieldPlan(fields))
  expect(ours.promptFields).toHaveLength(1)
  expect(ours.promptFields[0].id).toBe('otp')
  for (const options of [
    [{ id: 'complete', field_ids: fields.map((field) => field.id) }],
    [{ id: 'partial', field_ids: ['digit0'] }],
    [{ id: 'all' }]
  ])
    expect(mapAuthOptions(options, ours)).toEqual(original.baselineAuthOptions(options, ours))
  expect(mapAuthOptions([{ id: 'partial', field_ids: ['digit0'] }], ours)).toBeNull()
})

test('submission validation rejects unknown, non-string, oversized and missing required credentials', async () => {
  const original = await originalDocumentation()
  const fields = [{ id: 'username', required: true }, { id: 'password', required: true }]
  const cases = [
    { username: 'alice', password: 'secret' },
    { username: 'alice' },
    { username: 'alice', password: '' },
    { username: 'alice', password: 'secret', extra: 'unexpected' },
    { username: 'alice', password: 5 },
    { username: 'alice', password: 'x'.repeat(16 * 1024 + 1) },
    []
  ]
  for (const value of cases)
    expect(validateSubmittedFields(value, fields)).toEqual(original.baselineAuthSubmittedFields(value, fields))
  expect(validateSubmittedFields(cases[0], fields)).toEqual(cases[0])
  expect(cases.slice(1).map((value) => validateSubmittedFields(value, fields))).toEqual(Array(6).fill(null))
})

test('selected option rejects credentials outside its allowed prompt fields', async () => {
  const original = await originalDocumentation()
  const option = { id: 'password', field_ids: ['password'] }
  const plan = { promptFields: [{ id: 'username', required: false }, { id: 'password', required: true }] }
  for (const fields of [
    { password: 'secret' },
    { username: 'alice', password: 'secret' },
    { password: '' },
    {}
  ])
    expect(selectedOptionAcceptsFields(fields, option, plan)).toBe(
      original.baselineAuthSelectedFields(fields, option, plan)
    )
})
