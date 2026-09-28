interface PrivateFormArgument {
  username: { selector: string; name: string }
  password: { selector: string; name: string }
  submit: { selector: string; action: string }
  target: { origin: string; url: string }
  values?: { username: string; password: string }
}

/** Isolated-world private form preflight and submission; mirrors original jy boundary. */
export function privateAuthFormPage(element: Element, injected: any, arg: PrivateFormArgument): boolean {
  const document = element.ownerDocument
  const view = document.defaultView as any
  if (view == null || view.location.origin !== arg.target.origin) return false
  const username = injected.retarget(element, 'follow-label')
  const resolve = (selector: string) => {
    const matches = injected.querySelectorAll(injected.parseSelector(selector), document.documentElement)
    return matches.length === 1 ? matches[0] : undefined
  }
  const password = resolve(arg.password.selector)
  const submit = resolve(arg.submit.selector)
  if (!(username instanceof view.HTMLInputElement) ||
    !(password instanceof view.HTMLInputElement) ||
    !(submit instanceof view.HTMLButtonElement || submit instanceof view.HTMLInputElement)) return false
  const input = (control: Element, property: string) =>
    Reflect.get(view.HTMLInputElement.prototype, property, control)
  const form = input(username, 'form')
  const submitForm = Reflect.get(
    submit instanceof view.HTMLButtonElement ? view.HTMLButtonElement.prototype : view.HTMLInputElement.prototype,
    'form', submit)
  if (form == null || form !== input(password, 'form') || form !== submitForm ||
    input(username, 'name') !== arg.username.name || input(password, 'name') !== arg.password.name ||
    input(password, 'type') !== 'password' ||
    !['text', 'email', 'tel'].includes(input(username, 'type')) ||
    [username, password].some((control) => input(control, 'autocomplete').toLowerCase().split(/\s+/).includes('one-time-code')) ||
    [username, password].some((control) => ['visible', 'enabled', 'editable'].some((state) =>
      !injected.elementState(control, state).matches)) ||
    (arg.submit.action === 'click' && !injected.elementState(submit, 'enabled').matches)) return false
  const formProperty = (property: string) => Reflect.get(view.HTMLFormElement.prototype, property, form)
  const controlProperty = (control: Element, property: string) => Reflect.get(
    control instanceof view.HTMLButtonElement ? view.HTMLButtonElement.prototype : view.HTMLInputElement.prototype,
    property, control)
  const disabled = (control: Element) => view.Element.prototype.matches.call(control, ':disabled')
  const eligible = (control: Element) =>
    (control instanceof view.HTMLButtonElement || control instanceof view.HTMLInputElement) &&
    !disabled(control) && ['submit', 'image'].includes(controlProperty(control, 'type'))
  const controls = Array.from(formProperty('elements')) as Element[]
  const actualSubmit = eligible(submit) ? submit : controls.find(eligible)
  if (actualSubmit != null && controlProperty(actualSubmit, 'type') === 'image') return false
  const overridden = (attribute: string, property: string, fallback: string) =>
    actualSubmit != null && view.Element.prototype.hasAttribute.call(actualSubmit, attribute)
      ? controlProperty(actualSubmit, property) : fallback
  let action: URL
  try {
    action = new view.URL(overridden('formaction', 'formAction', formProperty('action')))
    action.hash = ''
  } catch { return false }
  const method = overridden('formmethod', 'formMethod', formProperty('method'))
  const enctype = overridden('formenctype', 'formEnctype', formProperty('enctype'))
  const target = overridden('formtarget', 'formTarget', formProperty('target'))
  if (action.href !== arg.target.url || action.origin !== arg.target.origin ||
    action.protocol !== 'https:' || method !== 'post' ||
    (target !== '' && target.toLowerCase() !== '_self') ||
    !['application/x-www-form-urlencoded', 'multipart/form-data'].includes(enctype)) return false
  const entries: Array<{ name: string; value: string }> = []
  const add = (name: string, value: string) => { entries.push({ name, value }) }
  let usernameCount = 0
  let passwordCount = 0
  for (const control of controls) {
    if (disabled(control) || control instanceof view.HTMLFieldSetElement ||
      control instanceof view.HTMLOutputElement) continue
    if (!(control instanceof view.HTMLInputElement || control instanceof view.HTMLButtonElement ||
      control instanceof view.HTMLSelectElement || control instanceof view.HTMLTextAreaElement) ||
      view.Element.prototype.hasAttribute.call(control, 'dirname')) return false
    const prototype = control instanceof view.HTMLInputElement ? view.HTMLInputElement.prototype
      : control instanceof view.HTMLButtonElement ? view.HTMLButtonElement.prototype
        : control instanceof view.HTMLSelectElement ? view.HTMLSelectElement.prototype
          : view.HTMLTextAreaElement.prototype
    const name = Reflect.get(prototype, 'name', control) as string
    if (!name) continue
    if (control === username) { usernameCount++; add(name, arg.values?.username ?? ''); continue }
    if (control === password) { passwordCount++; add(name, arg.values?.password ?? ''); continue }
    if (name === arg.username.name || name === arg.password.name) return false
    if (control instanceof view.HTMLInputElement) {
      const type = input(control, 'type')
      if (['file', 'password', 'image'].includes(type)) return false
      if (['reset', 'button'].includes(type) || (type === 'submit' && control !== actualSubmit) ||
        (['checkbox', 'radio'].includes(type) && !input(control, 'checked'))) continue
      add(name, input(control, 'value'))
    } else if (control instanceof view.HTMLButtonElement) {
      if (control === actualSubmit) add(name, Reflect.get(prototype, 'value', control))
    } else if (control instanceof view.HTMLTextAreaElement)
      add(name, Reflect.get(prototype, 'value', control))
    else {
      const options = Reflect.get(view.HTMLSelectElement.prototype, 'options', control)
      for (const option of Array.from(options) as Element[])
        if (!disabled(option) && Reflect.get(view.HTMLOptionElement.prototype, 'selected', option))
          add(name, Reflect.get(view.HTMLOptionElement.prototype, 'value', option))
    }
  }
  if (usernameCount !== 1 || passwordCount !== 1) return false
  if (arg.values == null) return true
  const create = (tag: string) => view.Document.prototype.createElement.call(document, tag)
  const append = (parent: Node, child: Node) => view.Node.prototype.appendChild.call(parent, child)
  const host = create('div')
  const shadow = view.Element.prototype.attachShadow.call(host, { mode: 'closed' })
  const isolatedForm = create('form')
  for (const [property, value] of Object.entries({
    action: action.href, method, enctype, target: '_self'
  })) {
    const setter = Object.getOwnPropertyDescriptor(view.HTMLFormElement.prototype, property)?.set
    if (setter == null) return false
    setter.call(isolatedForm, value)
  }
  const valueSetter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
  if (valueSetter == null) return false
  const hiddenInputs: Element[] = []
  for (const entry of entries) {
    const hidden = create('input')
    hidden.type = 'hidden'
    hidden.name = entry.name
    valueSetter.call(hidden, entry.value)
    hiddenInputs.push(hidden)
    append(isolatedForm, hidden)
  }
  append(shadow, isolatedForm)
  append(document.documentElement, host)
  try { view.HTMLFormElement.prototype.submit.call(isolatedForm) }
  finally { for (const hidden of hiddenInputs) valueSetter.call(hidden, '') }
  return true
}

/** Submit only through the inspected closed-shadow form, with a bound isolated selector. */
export async function submitPrivateAuthForm(
  tabId: string,
  timeoutMs: number | undefined,
  submission: PrivateFormArgument,
  values: { username: string; password: string },
  playwright: {
    withBoundPlaywrightSelector(tabId: string, selector: string,
      allowed: () => Promise<boolean>, run: (bound: any) => Promise<void>,
      options: { isolatedWorld: true; timeoutMs: number | undefined }): Promise<unknown>
    evaluateOnPlaywrightSelector(tabId: string, selector: string,
      page: typeof privateAuthFormPage,
      options: { arg: PrivateFormArgument; isolatedWorld: true; timeoutMs: number | undefined }): Promise<unknown>
  },
  revalidate: () => Promise<'origin_changed' | 'page_changed' | 'locator_invalid' | null>
) {
  let status: 'origin_changed' | 'page_changed' | 'locator_invalid' | 'submission_failed' | null = null
  try {
    await playwright.withBoundPlaywrightSelector(tabId, submission.username.selector,
      async () => ((status = await revalidate()), status == null),
      async (bound) => {
        const submitted = await bound.evaluateOnPlaywrightSelector(tabId,
          submission.username.selector, privateAuthFormPage,
          { arg: { ...submission, values }, isolatedWorld: true, timeoutMs })
        if (submitted !== true) status = 'submission_failed'
      }, { isolatedWorld: true, timeoutMs })
  } catch { return await revalidate() ?? 'submission_failed' }
  return status ?? 'submitted'
}
