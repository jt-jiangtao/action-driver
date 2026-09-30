export const nullableJson = (value: unknown | null): string | null =>
  value === null ? null : JSON.stringify(value)

export const parseNullableJson = (value: string | null): unknown | null =>
  value === null ? null : (JSON.parse(value) as unknown)
