import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * Builds a Postgres SQL fragment for an entity's "effective" date: a user-chosen, backdatable
 * date column (text, bare "YYYY-MM-DD") falling back to its `createdAt` column when not set.
 * Every period filter, trend chart, and list ordering must use this instead of the raw
 * `createdAt` column — otherwise a backdated row is correctly stored but never shows up under the
 * period it actually happened in (it would only ever appear under "today").
 *
 * Compared at ::date granularity on both sides, never as plain strings: the date column has no
 * time component, so string-comparing it against a full ISO timestamp would silently misorder
 * boundary cases (a 10-char date string sorts before any same-day timestamp string that continues
 * past it).
 */
export function effectiveDate(dateCol: SQLWrapper, createdAtCol: SQLWrapper) {
  return sql`coalesce(${dateCol}, ${createdAtCol})`
}

function dateLiteral(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function effectiveDateGte(dateCol: SQLWrapper, createdAtCol: SQLWrapper, value: Date): SQL {
  return sql`(${effectiveDate(dateCol, createdAtCol)})::date >= ${dateLiteral(value)}::date`
}

export function effectiveDateLt(dateCol: SQLWrapper, createdAtCol: SQLWrapper, value: Date): SQL {
  return sql`(${effectiveDate(dateCol, createdAtCol)})::date < ${dateLiteral(value)}::date`
}
