import { useEffect, useState } from 'react'

/**
 * Loads a blob and exposes it as an object URL, revoking it when the source changes or the
 * component unmounts. `load` is compared by reference, so callers memoize it.
 */
export function useObjectUrl(load: (() => Promise<Blob>) | null): {
  url: string | null
  error: boolean
} {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({
    url: null,
    error: load === null
  })
  useEffect(() => {
    if (!load) {
      setState({ url: null, error: true })
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setState({ url: null, error: false })
    load()
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, error: true })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [load])
  return state
}
