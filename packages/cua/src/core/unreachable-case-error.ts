export class UnreachableCaseError extends Error {
  constructor(value: never) {
    super(value)
    this.name = 'UnreachableCaseError'
  }
}
