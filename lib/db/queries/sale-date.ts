import { sales } from '../schema'
import { effectiveDate, effectiveDateGte, effectiveDateLt } from './effective-date'

/** A sale's "effective" date for reporting/filtering — see effective-date.ts. */
export const saleEffectiveDate = effectiveDate(sales.saleDate, sales.createdAt)

export const saleDateGte = (value: Date) => effectiveDateGte(sales.saleDate, sales.createdAt, value)
export const saleDateLt = (value: Date) => effectiveDateLt(sales.saleDate, sales.createdAt, value)
