import { PlaywrightLocator } from './locator.js'
type AuthSelector = string | PlaywrightLocator
interface AuthField {
  id: string
  label: string
  type: string
  required: boolean
  selector: AuthSelector
  autocomplete?: string | null | undefined
}
export interface BrowserAuthRequest {
  origin: string
  fields: AuthField[]
  qr_code?: boolean
  options?: Array<{
    id: string
    label: string
    field_ids?: string[] | null
    selector?: AuthSelector | null
  }> | null
  submit?: { action: 'click' | 'press_enter'; selector: AuthSelector } | null
}
function selector(value: AuthSelector, scope: { browserId: string; tabId: string }): string {
  if (typeof value === 'string') return value
  if (!(value instanceof PlaywrightLocator))
    throw new Error('browserAuth selector must be a string or PlaywrightLocator')
  const details = PlaywrightLocator.browserAuthSelector(value)
  if (details.browserId !== scope.browserId || details.tabId !== scope.tabId) {
    throw new Error('browserAuth selector locator must belong to this tab')
  }
  return details.selector
}
/** Payload projection only. The caller must subsequently validate the command schema. */
export function prepareBrowserAuthRequest(
  request: BrowserAuthRequest,
  scope: { browserId: string; tabId: string }
) {
  return {
    origin: request.origin,
    fields: request.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      selector: selector(field.selector, scope),
      ...(field.autocomplete === undefined ? {} : { autocomplete: field.autocomplete })
    })),
    ...(request.qr_code === true ? { qr_code: true as const } : {}),
    ...(request.options == null
      ? {}
      : {
          options: request.options.map((option) => ({
            id: option.id,
            label: option.label,
            ...(option.field_ids == null ? {} : { field_ids: option.field_ids }),
            ...(option.selector == null ? {} : { selector: selector(option.selector, scope) })
          }))
        }),
    ...(request.submit == null
      ? {}
      : {
          submit: {
            action: request.submit.action,
            selector: selector(request.submit.selector, scope)
          }
        })
  }
}
