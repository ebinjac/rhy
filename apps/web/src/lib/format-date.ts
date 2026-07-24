const locale = "en-IN"
const timeZone = "Asia/Kolkata"

export function formatDateTime(
  value: string | Date,
  style: "medium" | "full" = "medium"
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
    timeStyle: style === "full" ? "long" : "medium",
    timeZone,
  }).format(typeof value === "string" ? new Date(value) : value)
}

export function formatFullDate(value: string | Date) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone,
  }).format(typeof value === "string" ? new Date(value) : value)
}
