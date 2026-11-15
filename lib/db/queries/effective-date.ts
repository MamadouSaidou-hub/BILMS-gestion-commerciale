import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * Builds a Postgres SQL fragment for an entity's "effective" date: a user-chosen, backdatable
 * date column (text, bare "YYYY-MM-DD") falling back to its `createdAt` column when not set.
 * Every period filter, trend chart, and list ordering must use this instead of the raw
 * `createdAt` column — otherwise a backdated row is correctly stored but never shows up under the
 * period it actually happened in (it would only ever appear under "today").
 */
export function effectiveDate(dateCol: SQLWrapper, createdAtCol: SQLWrapper) {
  return sql`coalesce(${dateCol}, ${createdAtCol})`
}

/**
 * Compared as timestamps, cast on both sides rather than string-compared: the date column has no
 * time component, so comparing a bare "YYYY-MM-DD" against a full ISO timestamp as plain text
 * misorders day boundaries (the 10-char string sorts before any same-day timestamp continuing
 * past it). Casting a date-only value yields that day's midnight, which keeps it inside a period
 * starting at midnight — and, unlike a ::date comparison, still works for the sub-day (hourly)
 * buckets the "Aujourd'hui" trend charts use, where both ends of a bucket fall on the same date.
 */
export function effectiveDateGte(dateCol: SQLWrapper, createdAtCol: SQLWrapper, value: Date): SQL {
  return sql`(${effectiveDate(dateCol, createdAtCol)})::timestamptz >= ${value.toISOString()}::timestamptz`
}

export function effectiveDateLt(dateCol: SQLWrapper, createdAtCol: SQLWrapper, value: Date): SQL {
  return sql`(${effectiveDate(dateCol, createdAtCol)})::timestamptz < ${value.toISOString()}::timestamptz`
}
