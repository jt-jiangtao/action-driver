/** Autonomous contracts approved by the user; original runtime bodies were absent. */
export function createDelayedAction<Args extends unknown[]>(
  action: (...args: Args) => void,
  delayMs = 0
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return function (this: unknown, ...args: Args) {
    if (timer !== undefined) clearTimeout(timer)
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- preserve the caller across the timer
    const receiver = this
    timer = setTimeout(() => {
      timer = undefined
      action.apply(receiver, args)
    }, delayMs)
  }
}
export function createLazyEvaluator<T extends (...args: any[]) => any>(
  evaluate: T
): (...params: Parameters<T>) => ReturnType<T> {
  let initialized = false,
    result!: ReturnType<T>
  return function (this: unknown, ...params: Parameters<T>) {
    if (!initialized) {
      const value = evaluate.apply(this, params) as ReturnType<T>
      result = value
      initialized = true
    }
    return result
  }
}
export function sleep(ms: number): Promise<unknown> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export function* enumerate<T>(
  iterable: Iterable<T>
): Generator<readonly [number, T], void, unknown> {
  let index = 0
  for (const value of iterable) yield [index++, value] as const
}
export namespace enumerate {
  export const async = async function* <T>(
    iterable: AsyncIterable<T>
  ): AsyncGenerator<readonly [number, Awaited<T>], void, unknown> {
    let index = 0
    for await (const value of iterable) yield [index++, value] as const
  }
}
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
