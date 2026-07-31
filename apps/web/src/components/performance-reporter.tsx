import { useEffect } from "react"

type SupportedEntry = PerformanceEntry & {
  value?: number
  hadRecentInput?: boolean
  interactionId?: number
  duration: number
}

export function PerformanceReporter() {
  useEffect(() => {
    const pathname = window.location.pathname
    if (
      typeof PerformanceObserver === "undefined" ||
      navigator.webdriver ||
      pathname.startsWith("/docs")
    ) {
      return
    }
    let cumulativeLayoutShift = 0
    let largestContentfulPaint = 0
    let interactionLatency = 0
    const observers: PerformanceObserver[] = []
    observe("largest-contentful-paint", (entry) => {
      largestContentfulPaint = entry.startTime
    })
    observe("layout-shift", (entry) => {
      if (!entry.hadRecentInput) cumulativeLayoutShift += entry.value ?? 0
    })
    observe("event", (entry) => {
      if ((entry.interactionId ?? 0) > 0) {
        interactionLatency = Math.max(interactionLatency, entry.duration)
      }
    }, 40)

    const report = () => {
      if (largestContentfulPaint > 0) {
        sendVital("LCP", largestContentfulPaint, pathname)
      }
      sendVital("CLS", cumulativeLayoutShift, pathname)
      if (interactionLatency > 0) {
        sendVital("INP", interactionLatency, pathname)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report()
    }
    window.addEventListener("pagehide", report, { once: true })
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      observers.forEach((observer) => observer.disconnect())
      window.removeEventListener("pagehide", report)
      document.removeEventListener("visibilitychange", onVisibility)
    }

    function observe(
      type: string,
      onEntry: (entry: SupportedEntry) => void,
      durationThreshold?: number
    ) {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => onEntry(entry))
        })
        observer.observe({
          type,
          buffered: true,
          ...(durationThreshold ? { durationThreshold } : {}),
        })
        observers.push(observer)
      } catch {
        // Unsupported performance entry types are normal in older browsers.
      }
    }
  }, [])

  return null
}

function sendVital(metric: "LCP" | "CLS" | "INP", value: number, route: string) {
  void fetch("/internal/web-vitals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metric, value, route: normalizeRoute(route) }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined)
}

function normalizeRoute(pathname: string) {
  return pathname
    .split("/")
    .map((segment) =>
      segment.length >= 20 || /^\d+$/.test(segment) ? ":id" : segment
    )
    .join("/")
}
