export class EventQueue<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = []
  private readonly waiting: { resolve(value: IteratorResult<T>): void; reject(error: Error): void }[] = []
  private closed = false
  private error: Error | undefined
  constructor(private readonly capacity = 128) {}
  push(value: T): void {
    if (this.closed) throw new Error('Event queue is closed')
    const waiter = this.waiting.shift()
    if (waiter) waiter.resolve({ value, done: false })
    else {
      if (this.values.length >= this.capacity) throw new Error('Event queue overflow')
      this.values.push(value)
    }
  }
  end(): void { this.closed = true; for (const waiter of this.waiting.splice(0)) waiter.resolve({ value: undefined, done: true }) }
  fail(error: Error): void { this.error = error; this.closed = true; for (const waiter of this.waiting.splice(0)) waiter.reject(error) }
  next(): Promise<IteratorResult<T>> {
    if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false })
    if (this.error) return Promise.reject(this.error)
    if (this.closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }))
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this }
}
