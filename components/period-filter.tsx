'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export const PERIODS = ['Aujourd’hui', '7 derniers jours', 'Ce mois-ci', 'Un mois précis', 'Entre deux mois', 'Cette année', 'Année précédente', 'Personnalisé']

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function currentMonthIso() {
  return new Date().toISOString().slice(0, 7)
}

// Turns a "YYYY-MM" month into the first/last calendar day it covers, so "Un mois précis" and
// "Entre deux mois" can both be expressed as the from/to range the server already understands —
// no server-side change needed, just friendlier pickers over the same custom-range plumbing.
function monthBounds(month: string) {
  const [year, m] = month.split('-').map(Number)
  const lastDay = new Date(year, m, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

// "Année précédente" needs no picker — it's always the full calendar year before this one, so
// once the calendar rolls to 2027 this still means "2026" without the user having to touch dates.
function previousYearBounds() {
  const year = new Date().getFullYear() - 1
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

/**
 * Period selection shared by every list/report screen: the named periods plus three ways to pick
 * an explicit range — a single month, a month-to-month span, or a raw day-to-day custom range.
 * Returns the state and a `params()` helper that already carries `from`/`to` when any of those is
 * active, so each screen builds its query string the same way — and a `ready` flag to hold off
 * fetching while a half-filled range would query nonsense.
 */
export function usePeriodFilter(initial: string = 'Cette année') {
  const [period, setPeriod] = useState(initial)
  const [customFrom, setCustomFrom] = useState(todayIso)
  const [customTo, setCustomTo] = useState(todayIso)
  const [month, setMonth] = useState(currentMonthIso)
  const [monthFrom, setMonthFrom] = useState(currentMonthIso)
  const [monthTo, setMonthTo] = useState(currentMonthIso)

  const isSingleMonth = period === 'Un mois précis'
  const isMonthRange = period === 'Entre deux mois'
  const isPreviousYear = period === 'Année précédente'
  const isRawCustom = period === 'Personnalisé'
  const isCustom = isSingleMonth || isMonthRange || isPreviousYear || isRawCustom

  const ready = isSingleMonth
    ? Boolean(month)
    : isMonthRange
      ? Boolean(monthFrom && monthTo && monthFrom <= monthTo)
      : !isRawCustom || Boolean(customFrom && customTo && customFrom <= customTo)

  function params(extra: Record<string, string> = {}) {
    // The server only ever needs to know "named period" or "custom from/to" — which picker
    // produced the range is a UI concern only.
    const search = new URLSearchParams({ period: isCustom ? 'Personnalisé' : period, ...extra })
    if (isSingleMonth) {
      const bounds = monthBounds(month)
      search.set('from', bounds.from)
      search.set('to', bounds.to)
    } else if (isMonthRange) {
      search.set('from', monthBounds(monthFrom).from)
      search.set('to', monthBounds(monthTo).to)
    } else if (isPreviousYear) {
      const bounds = previousYearBounds()
      search.set('from', bounds.from)
      search.set('to', bounds.to)
    } else if (isRawCustom) {
      search.set('from', customFrom)
      search.set('to', customTo)
    }
    return search
  }

  const signature = [period, customFrom, customTo, month, monthFrom, monthTo].join('|')

  return {
    period,
    setPeriod,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    month,
    setMonth,
    monthFrom,
    setMonthFrom,
    monthTo,
    setMonthTo,
    isCustom,
    ready,
    params,
    signature,
  }
}

export type PeriodFilterState = ReturnType<typeof usePeriodFilter>

export function PeriodFilter({ state }: { state: PeriodFilterState }) {
  return (
    <>
      <label className="select-wrap">
        <span className="sr-only">Période</span>
        <select value={state.period} onChange={(event) => state.setPeriod(event.target.value)}>
          {PERIODS.map((item) => <option key={item}>{item}</option>)}
        </select>
        <ChevronDown />
      </label>
      {state.period === 'Un mois précis' && (
        <div className="date-range-row">
          <input type="month" value={state.month} onChange={(event) => state.setMonth(event.target.value)} aria-label="Mois" />
        </div>
      )}
      {state.period === 'Entre deux mois' && (
        <div className="date-range-row">
          <input type="month" value={state.monthFrom} max={state.monthTo} onChange={(event) => state.setMonthFrom(event.target.value)} aria-label="Du mois" />
          <span>—</span>
          <input type="month" value={state.monthTo} min={state.monthFrom} onChange={(event) => state.setMonthTo(event.target.value)} aria-label="Au mois" />
        </div>
      )}
      {state.period === 'Personnalisé' && (
        <div className="date-range-row">
          <input type="date" value={state.customFrom} max={state.customTo} onChange={(event) => state.setCustomFrom(event.target.value)} aria-label="Du" />
          <span>—</span>
          <input type="date" value={state.customTo} min={state.customFrom} onChange={(event) => state.setCustomTo(event.target.value)} aria-label="Au" />
        </div>
      )}
    </>
  )
}
