export function evaluationScript(
  pageFunction: unknown,
  arg: unknown,
  mode: 'page' | 'single' | 'all'
): string {
  let encoded = 'undefined'
  if (arg !== undefined) {
    let json: string | undefined
    try {
      json = JSON.stringify(arg)
    } catch (error) {
      const wrapped = new Error(
        `${error instanceof Error ? error.message : String(error)}\nplaywright.evaluate arg must be JSON-serializable`
      )
      if (error instanceof Error && error.stack)
        wrapped.stack = `${wrapped.name}: ${wrapped.message}\n${error.stack}`
      throw wrapped
    }
    if (json === undefined) throw new Error('playwright.evaluate arg must be JSON-serializable')
    encoded = json
  }
  const label =
    mode === 'page'
      ? 'playwright.evaluate'
      : mode === 'all'
        ? 'locator.evaluateAll'
        : 'locator.evaluate'
  let script: string
  if (typeof pageFunction === 'string') {
    if (!pageFunction.length) throw new Error(`${label} requires a pageFunction`)
    script = `const arg = ${encoded};\nreturn (${pageFunction});`
  } else if (typeof pageFunction === 'function') {
    script = `const arg = ${encoded};\nconst __playwrightEvaluate = (${pageFunction.toString()});\nreturn await __playwrightEvaluate(${mode === 'page' ? 'arg' : mode === 'all' ? 'elements, arg' : 'element, arg'});`
  } else throw new Error(`${label} requires a string or function`)
  return script
}
