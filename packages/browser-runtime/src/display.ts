export type RenderedValue =
  | { type: 'function'; value: undefined }
  | { type: 'value'; value: string | number | boolean | null | undefined }
  | { type: 'object' | 'error'; value: string }
export interface DisplayBridge {
  displayImage(bytes: Uint8Array): void | Promise<void>
  displayValue(value: RenderedValue): void | Promise<void>
}
function truncate(value: string, max: number | undefined): string {
  if (!Number.isInteger(max) || !(max! > 0) || value.length <= max!) return value
  return `${value.slice(0, max)}[truncated ${value.length - max!} chars]`
}
function primitive(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (value instanceof String || value instanceof Boolean) return value.valueOf()
  if (value instanceof Number) {
    const number = value.valueOf()
    return Number.isFinite(number) ? number : undefined
  }
}
export async function displayValue(
  bridge: DisplayBridge,
  value: unknown,
  maxChars?: number
): Promise<void> {
  let rendered: RenderedValue | undefined
  try {
    if (value instanceof Uint8Array) {
      await bridge.displayImage(value)
      return
    }
    if (value === undefined) rendered = { type: 'value', value: undefined }
    else if (typeof value === 'function') rendered = { type: 'function', value: undefined }
    else {
      const simple = primitive(value)
      if (simple !== undefined) rendered = { type: 'value', value: simple }
    }
    if (!rendered) {
      let json = JSON.stringify(value)
      if (json === undefined) json = String(value)
      rendered = { type: 'object', value: json }
    }
  } catch (error) {
    rendered = { type: 'error', value: String(error) }
  }
  if (
    rendered.type === 'object' ||
    rendered.type === 'error' ||
    (rendered.type === 'value' && typeof rendered.value === 'string')
  )
    rendered = { ...rendered, value: truncate(rendered.value as string, maxChars) }
  await bridge.displayValue(rendered)
}
export function createDisplaySideEffect(
  bridge: DisplayBridge,
  maxChars?: number
): (value: unknown) => Promise<void> {
  return (value) => displayValue(bridge, value, maxChars)
}
