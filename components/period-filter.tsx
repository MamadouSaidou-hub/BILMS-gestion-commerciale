'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export const PERIODS = ['Aujourd’hui', '7 derniers jours', 'Ce mois-ci', 'Cette année', 'Personnalisé']

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Period selection shared by every list/report screen: the named periods plus a custom from/to
 * range. Returns the state and a `params()` helper that already carries `from`/`to` when the
 * custom range is active, so each screen builds its query string the same way — and a `ready`
 * flag to hold off fetching while a half-filled custom range would query nonsense.
 */
export function usePeriodFilter(initial: string = PERIODS[1]) {
  const [period, setPeriod] = useState(initial)
  const [customFrom, setCustomFrom] = useState(todayIso)
  const [customTo, setCustomTo] = useState(todayIso)

  const isCustom = period === 'Personnalisé'
  const ready = !isCustom || Boolean(customFrom && customTo && customFrom <= customTo)

  function params(extra: Record<string, string> = {}) {
    const search = new URLSearchParams({ period, ...extra })
    if (isCustom) {
      search.set('from', customFrom)
      search.set('to', customTo)
    }
    return search
  }

  return { period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, isCustom, ready, params }
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
      {state.isCustom && (
        <div className="date-range-row">
          <input type="date" value={state.customFrom} max={state.customTo} onChange={(event) => state.setCustomFrom(event.target.value)} aria-label="Du" />
          <span>—</span>
          <input type="date" value={state.customTo} min={state.customFrom} onChange={(event) => state.setCustomTo(event.target.value)} aria-label="Au" />
        </div>
      )}
    </>
  )
}
