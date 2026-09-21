const TEST_ID_PATTERN =
  /^e2e\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|:[a-z][a-z0-9-]*)){2,}#(?:button|link|input|checkbox|radio|option|menuitem|tab|page|section|nav|dialog|status|select|textarea|switch)$/

export function e2eId(pattern: string, params: Readonly<Record<string, string>>): string {
  if (!TEST_ID_PATTERN.test(pattern)) throw new Error(`Invalid E2E test id pattern: ${pattern}`)

  const placeholders = [...pattern.matchAll(/:([a-z][a-z0-9-]*)/g)].map((match) => match[1]!)
  const provided = Object.keys(params)
  for (const placeholder of placeholders) {
    if (!(placeholder in params)) throw new Error(`Missing E2E test id parameter: ${placeholder}`)
  }
  for (const name of provided) {
    if (!placeholders.includes(name)) throw new Error(`Unused E2E test id parameter: ${name}`)
  }

  return placeholders.reduce(
    (value, name) => value.replace(`:${name}`, encodeURIComponent(params[name]!)),
    pattern
  )
}
