import type { RefinementCtx } from 'zod/v3'
export function selectionRefinement(
  value: { value?: string | undefined; label?: string | undefined; index?: number | undefined },
  context: RefinementCtx
) {
  if (value.value === undefined && value.label === undefined && value.index === undefined)
    context.addIssue({ code: 'custom', message: 'Select option requires value, label, or index' })
}
export function clipboardRefinement(
  value: { text?: string | undefined; base64?: string | undefined },
  context: RefinementCtx
) {
  if ((value.text !== undefined) === (value.base64 !== undefined))
    context.addIssue({
      code: 'custom',
      message: 'Clipboard entries must set exactly one of text or base64'
    })
}
