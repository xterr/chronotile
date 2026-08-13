import { useEffect, useRef, useState } from "react"

interface QueryResult<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  enabled = true,
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const id = ++requestId.current
    Promise.resolve()
      .then(() => {
        if (requestId.current !== id) return null
        setLoading(true)
        setError(null)
        return fetcher()
      })
      .then((result) => {
        if (requestId.current === id && result !== null) setData(result)
      })
      .catch((err: unknown) => {
        if (requestId.current === id) setError(String(err))
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])

  return { data, loading, error }
}
