/** Parser boundary supplied by a command's schema; no schema engine is implemented here. */
export interface PayloadParser<T> {
  parse(payload: unknown): T
}
/** Serialization and explicit validation retain separate original lifecycle steps. */
export class AtlasCommand<T = unknown> {
  constructor(
    public type: string,
    public schema: PayloadParser<T>,
    public payload: unknown
  ) {}
  parse(): T {
    return this.schema.parse(this.payload)
  }
  toJSON(): Record<string, unknown> {
    // Object spread also handles nullish/primitive input, as the original command does.
    return { type: this.type, ...(this.payload as Record<string, unknown>) }
  }
}
