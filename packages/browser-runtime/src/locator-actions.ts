export interface Selection {
  value?: string
  label?: string
  index?: number
}
export function selections(input: string | Selection | (string | Selection)[]): Selection[] {
  const values = Array.isArray(input) ? input : [input]
  if (!values.length) throw new Error('locator.selectOption requires at least one value')
  return values.map((value) => {
    if (typeof value === 'string') return { value }
    if (!value || typeof value !== 'object')
      throw new Error('locator.selectOption requires a string or { value?, label?, index? }')
    const selection: Selection = {}
    if (value.value !== undefined) {
      if (typeof value.value !== 'string')
        throw new Error('locator.selectOption value must be a string')
      selection.value = value.value
    }
    if (value.label !== undefined) {
      if (typeof value.label !== 'string')
        throw new Error('locator.selectOption label must be a string')
      selection.label = value.label
    }
    if (value.index !== undefined) {
      if (!Number.isInteger(value.index) || value.index < 0)
        throw new Error('locator.selectOption index must be a non-negative integer')
      selection.index = value.index
    }
    if (
      selection.value === undefined &&
      selection.label === undefined &&
      selection.index === undefined
    )
      throw new Error('locator.selectOption requires value, label, or index for each selection')
    return selection
  })
}
export function contextualError(error: unknown, context: string): Error {
  const result = new Error(`${error instanceof Error ? error.message : String(error)}\n${context}`)
  if (error instanceof Error && error.stack)
    result.stack = `${result.name}: ${result.message}\n${error.stack}`
  return result
}
export function inspectElements(elements: Element[]) {
  const matchCount = elements.length
  const visibleCount = elements.reduce(
    (total, element) => total + Number(element.getClientRects().length > 0),
    0
  )
  const matches = elements.slice(0, 5).map((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    type: element.getAttribute('type'),
    ariaLabel: element.getAttribute('aria-label'),
    text: element.textContent?.trim().slice(0, 120) ?? '',
    visible: element.getClientRects().length > 0,
    disabled: 'disabled' in element && !!element.disabled
  }))
  return { matchCount, visibleCount, matches }
}
export function diagnosticKind(
  error: unknown,
  counts: { matchCount: number; visibleCount: number }
) {
  const message = error instanceof Error ? error.message : String(error)
  if (/strict mode violation/i.test(message)) return 'multiple_matches'
  if (/intercept|receives pointer events/i.test(message)) return 'intercepted'
  if (counts.matchCount === 0) return 'no_matches'
  if (counts.visibleCount === 0) return 'no_visible_match'
  return 'action_failed'
}
