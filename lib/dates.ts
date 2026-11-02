// Plain "YYYY-MM-DD" date string arithmetic — every date in this app (rentals, leases) is stored
// as that kind of string, not a timestamp, so these avoid timezone drift from parsing/reformatting
// through a full Date-with-time object.

export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function addMonths(dateStr: string, months: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

export function daysUntil(dateStr: string): number {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const target = new Date(`${dateStr}T00:00:00Z`)
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}
