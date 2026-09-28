const regexSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')?.get
export function isRegExp(value: unknown): value is RegExp {
  if (value === null || typeof value !== 'object' || !regexSource) return false
  try {
    Reflect.apply(regexSource, value, [])
    return true
  } catch {
    return false
  }
}
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || Object.getPrototypeOf(prototype) === null
}
export function hasErrorMessage(value: unknown, message: string): boolean {
  if (value === null || typeof value !== 'object') return false
  try {
    return 'message' in value && Reflect.get(value, 'message') === message
  } catch {
    return false
  }
}
export function generateRequestId(): string {
  return `req-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}
