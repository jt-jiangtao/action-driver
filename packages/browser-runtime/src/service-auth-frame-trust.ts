import { captureAuthSelectorBinding, type AuthSelectorBinding } from './service-auth-form-binding.js'

type Registration = Pick<AuthSelectorBinding, 'domainAndRegistry' | 'url'>
interface Request {
  tab_id: string
  timeout_ms?: number
  fields: Array<{ selector: string }>
  submit?: { selector: string } | null
  options?: Array<{ selector?: string | null }> | null
}
type SelectorContext = Parameters<typeof captureAuthSelectorBinding>[3]

/** The original d_ uses CDP registrable domains when both are present. */
export function sameAuthRegistration(left: Registration, right: Registration): boolean {
  return left.domainAndRegistry && right.domainAndRegistry
    ? left.domainAndRegistry === right.domainAndRegistry
    : new URL(left.url).hostname === new URL(right.url).hostname
}

/** Every intermediate nested frame must belong to the top page or credential frame. */
export async function trustAuthFrameChain(
  top: Registration, form: Registration, request: Request, context: SelectorContext
): Promise<boolean> {
  const selectors = [
    ...request.fields.map(({ selector }) => selector),
    ...(request.submit == null ? [] : [request.submit.selector]),
    ...(request.options ?? []).flatMap(({ selector }) => selector == null ? [] : [selector])
  ]
  const prefixes = new Set<string>()
  for (const selector of selectors) {
    let count = 0
    for (const match of selector.matchAll(/>>\s*internal:control\s*=\s*enter-frame\s*>>/g))
      if (count++ > 0) prefixes.add(selector.slice(0, match.index).trimEnd())
  }
  try {
    const bindings = await Promise.all(Array.from(prefixes, (prefix) =>
      captureAuthSelectorBinding(request.tab_id, prefix, request.timeout_ms, context)))
    return bindings.every((binding) =>
      sameAuthRegistration(top, binding) || sameAuthRegistration(form, binding))
  } catch { return false }
}

export async function trustAuthFormOrigin(
  top: Registration, form: AuthSelectorBinding, request: Request, context: SelectorContext
): Promise<boolean> {
  if (!sameAuthRegistration(top, form) &&
    (!top.domainAndRegistry || !form.domainAndRegistry)) return false
  return await trustAuthFrameChain(top, form, request, context)
}
