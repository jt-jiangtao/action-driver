type MapKey = string | number | symbol
export type MirrorMap<T extends Record<MapKey, MapKey>> = T & Record<T[keyof T], keyof T>
/** Preserves the baseline's Object.entries ordering and last-write collision behavior. */
export function mirrorMap<T extends Record<MapKey, MapKey>>(map: T): MirrorMap<T> {
  const result: Record<MapKey, MapKey> = {}
  for (const [key, value] of Object.entries(map)) {
    result[key] = value
    result[value] = key
  }
  return result as MirrorMap<T>
}
