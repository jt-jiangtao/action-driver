/** Pure request and credential checks used before opening the secure auth broker. */
export interface AuthFieldInput {
  id: string
  selector: string
  label?: string
  type?: string
  required?: boolean
  autocomplete?: string | null
  labelMetadata?: Record<string, unknown> & {
    accessible_name?: string | null
    autocomplete?: string | null
    input_type?: string
    input_mode?: string | null
    input_name?: string | null
  }
}
export interface AuthOptionInput {
  id: string
  selector?: string | null
  field_ids?: string[] | null
  [key: string]: unknown
}
export interface AuthRequestShape {
  fields: Array<Pick<AuthFieldInput, 'id' | 'selector'>>
  options?: AuthOptionInput[] | null
  submit?: { action: string; selector: string } | null
  qr_code?: boolean
}
export function validateAuthSelectors(request: AuthRequestShape): boolean {
  const fieldIds = new Set<string>()
  const fieldSelectors = new Set<string>()
  for (const field of request.fields) {
    if (fieldIds.has(field.id) || fieldSelectors.has(field.selector)) return false
    fieldIds.add(field.id)
    fieldSelectors.add(field.selector)
  }
  if (request.options != null) {
    const optionIds = new Set<string>()
    const optionSelectors = new Set<string>()
    for (const option of request.options) {
      if (optionIds.has(option.id)) return false
      optionIds.add(option.id)
      if (option.selector != null) {
        if (optionSelectors.has(option.selector) || fieldSelectors.has(option.selector)) return false
        optionSelectors.add(option.selector)
      }
      const ids = option.field_ids ?? []
      if (new Set(ids).size !== ids.length || ids.some((id) => !fieldIds.has(id))) return false
    }
  }
  return request.submit == null ||
    request.submit.action === 'press_enter' ||
    !fieldSelectors.has(request.submit.selector)
}
export function isQrOnlyAuth(request: Pick<AuthRequestShape, 'qr_code' | 'fields' | 'options' | 'submit'>): boolean {
  return request.qr_code === true && request.fields.length === 0 &&
    request.options == null && request.submit == null
}
interface InspectedField extends AuthFieldInput {
  id: string
  label: string
  type: string
  required: boolean
  labelMetadata: NonNullable<AuthFieldInput['labelMetadata']>
}
export interface CredentialPlan {
  credentialFieldMetadata: Array<Record<string, unknown>>
  promptFields: Array<Record<string, unknown> & { id: string; required: boolean }>
  fillFields: Array<{ promptId: string; fields: InspectedField[] }>
}
export function planCredentialFields(fields: InspectedField[]): CredentialPlan {
  const first = fields[0]
  const oneTimeCode = fields.length >= 4 && fields.every((field) =>
    field.autocomplete?.toLowerCase() === 'one-time-code' ||
    field.labelMetadata.autocomplete === 'one-time-code' ||
    field.labelMetadata.input_mode === 'numeric'
  ) && fields.every((field) => field.type === first?.type)
  if (first != null && oneTimeCode) return {
    credentialFieldMetadata: fields.map(({ labelMetadata }) => ({ id: 'otp', ...labelMetadata })),
    promptFields: [{
      id: 'otp', label: 'Verification code',
      label_metadata: {
        ...first.labelMetadata,
        accessible_name: null,
        autocomplete: 'one-time-code',
        input_name: null
      },
      type: first.type, autocomplete: 'one-time-code', required: true
    }],
    fillFields: [{ promptId: 'otp', fields }]
  }
  return {
    credentialFieldMetadata: fields.map(({ id, labelMetadata }) => ({ id, ...labelMetadata })),
    promptFields: fields.map(({ id, label, labelMetadata, type, autocomplete, required }) => ({
      id, label, label_metadata: labelMetadata, type, autocomplete, required
    })),
    fillFields: fields.map((field) => ({ promptId: field.id, fields: [field] }))
  }
}
export function mapAuthOptions<T extends AuthOptionInput>(options: T[] | null | undefined, plan: CredentialPlan): T[] | null | undefined {
  if (options == null) return undefined
  const result: T[] = []
  for (const option of options) {
    if (option.field_ids == null) {
      result.push(option)
      continue
    }
    const selected = new Set(option.field_ids)
    const promptIds: string[] = []
    let covered = 0
    for (const group of plan.fillFields) {
      const included = group.fields.filter(({ id }) => selected.has(id))
      if (included.length === 0) continue
      if (included.length !== group.fields.length) return null
      covered += included.length
      promptIds.push(group.promptId)
    }
    if (covered !== selected.size) return null
    result.push({ ...option, field_ids: promptIds })
  }
  return result
}
export function validateSubmittedFields(value: unknown, fields: Array<{ id: string; required: boolean }>): Record<string, string> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  const accepted = new Set(fields.map(({ id }) => id))
  const result: Record<string, string> = Object.create(null)
  for (const [id, fieldValue] of Object.entries(value)) {
    if (!accepted.has(id) || typeof fieldValue !== 'string' || fieldValue.length > 16 * 1024) return null
    result[id] = fieldValue
  }
  if (fields.some(({ id, required }) => required && !result[id])) return null
  return result
}
export function selectedOptionAcceptsFields(
  values: Record<string, string>,
  option: { field_ids?: string[] | null },
  plan: Pick<CredentialPlan, 'promptFields'>
): boolean {
  const accepted = new Set(option.field_ids ?? [])
  for (const field of plan.promptFields) {
    if ((values[field.id] != null && !accepted.has(field.id)) ||
      (accepted.has(field.id) && field.required && !values[field.id])) return false
  }
  return true
}
