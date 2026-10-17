const easternSuccessfulUpdateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
})

/**
 * Display the persisted successful-import instant, never an attempt/start time.
 * Unzoned strings are not reliable instants and must not use the browser's zone.
 */
export function formatSupplierSuccessfulUpdate(
  value: string | Date | null | undefined,
): string {
  if (value == null) return "Unknown"
  if (typeof value === "string" &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return "Unknown"
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return "Unknown"
  const parts = Object.fromEntries(
    easternSuccessfulUpdateFormatter.formatToParts(date).map(part => [part.type, part.value]),
  )
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`
}
