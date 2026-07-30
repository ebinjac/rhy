import * as React from "react"

const DEFAULT_TIMEOUT_MS = 1800

export function useCopyToClipboard({
  timeout = DEFAULT_TIMEOUT_MS,
}: {
  timeout?: number
} = {}) {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  async function copy(value: string) {
    if (!value) {
      return false
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        setCopied(false)
        timeoutRef.current = null
      }, timeout)
      return true
    } catch {
      setCopied(false)
      return false
    }
  }

  function reset() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setCopied(false)
  }

  return { copied, copy, reset }
}
