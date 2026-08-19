type ClientErrorSource = "application" | "route"

const reported = new Set<string>()

export function reportClientError(
  error: Error,
  source: ClientErrorSource,
  pathname = window.location.pathname
) {
  const payload = {
    source,
    name: sanitize(error.name, 80),
    message: sanitize(error.message, 500),
    stack: sanitizeStack(error.stack),
    route: normalizeRoute(pathname),
  }
  const fingerprint = JSON.stringify(payload)
  if (reported.has(fingerprint)) return
  reported.add(fingerprint)

  void fetch("/internal/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
    .slice(0, 300)
}

function sanitizeStack(stack: string | undefined) {
  if (!stack) return ""
  return stack
    .split("\n")
    .slice(0, 12)
    .map((line) => line.replace(/https?:\/\/[^/\s]+/g, "<origin>"))
    .join("\n")
    .replace(
      /([?&](?:token|key|secret|password|authorization)=)[^&\s)]+/gi,
      "$1<MASKED>"
    )
    .slice(0, 2500)
}

function sanitize(value: string, maximum: number) {
  return value
    .replace(/https?:\/\/[^/\s]+/g, "<origin>")
    .replace(
      /([?&](?:token|key|secret|password|authorization)=)[^&\s)]+/gi,
      "$1<MASKED>"
    )
    .replace(/\b(?:Bearer|Api-Token)\s+[^\s,;]+/gi, (match) => {
      const scheme = match.slice(0, match.indexOf(" "))
      return `${scheme} <MASKED>`
    })
    .slice(0, maximum)
}
