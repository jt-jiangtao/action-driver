/** Autonomous contract implementation: original package provided declarations only. */
export interface EnvArgs<T extends readonly string[]> {
  name: string
  options: T
  default: T[number]
  missing?: 'default' | 'throw'
  invalid?: 'throw' | 'default'
  normalize?: (raw: string) => string
}
export function env<const T extends readonly string[]>(
  args: EnvArgs<T>
): { get: () => T[number]; help: () => string } {
  if (!args.options.includes(args.default))
    throw new Error(`${args.name} default must be one of: ${args.options.join(', ')}`)
  const missing = args.missing ?? 'default',
    invalid = args.invalid ?? 'throw',
    normalize = args.normalize ?? ((raw: string) => raw.trim().toLowerCase())
  let initialized = false,
    value!: T[number]
  return {
    get() {
      if (initialized) return value
      const raw = process.env[args.name],
        normalized = raw === undefined ? undefined : normalize(raw)
      if (normalized === undefined || normalized === '') {
        if (missing === 'throw') throw new Error(`${args.name} is required`)
        value = args.default
      } else if (args.options.includes(normalized)) value = normalized as T[number]
      else {
        if (invalid === 'throw')
          throw new Error(
            `Invalid ${args.name} value ${JSON.stringify(normalized)}; expected one of: ${args.options.join(', ')}`
          )
        value = args.default
      }
      initialized = true
      return value
    },
    help: () =>
      `${args.name}: ${args.options.join(' | ')} (default: ${args.default}; missing: ${missing}; invalid: ${invalid})`
  }
}
/** Returns, rather than throws, a project-defined diagnostic. */
export function unimplemented(tool: string): Error {
  return new Error(`Tool not implemented: ${tool}`)
}
