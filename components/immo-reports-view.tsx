'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Download, FileSpreadsheet, Percent, TrendingUp, Wallet } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'
import { exportImmoReportExcel, exportImmoReportPdf, type ImmoReportsData } from '@/lib/export-immo-report'

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Wallet; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function RankBar({ label, value, formatted, max, color, href }: { label: string; value: number; formatted: string; max: number; color: string; href?: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0
  const content = <span className="rank-bar-label" title={label}>{label}</span>
  return (
    <div className="rank-bar-row">
      {href ? <Link href={href}>{content}</Link> : content}
      <div className="rank-bar-track"><div className="rank-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="rank-bar-value">{formatted}</span>
    </div>
  )
}

export function ImmoReportsView() {
  const [data, setData] = useState<ImmoReportsData | null>(null)
  const [period, setPeriod] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    const params = period ? `?period=${encodeURIComponent(period)}` : ''
    fetchJson<ImmoReportsData>(`/api/immo/rapports${params}`)
      .then((json) => {
        setData(json)
        if (!period) setPeriod(json.period)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [period, refreshKey])

  const maxExpense = useMemo(() => Math.max(1, ...(data?.expensesByCategory ?? []).map((row) => row.amount)), [data])
  const maxTenant = useMemo(() => Math.max(1, ...(data?.topTenants ?? []).map((row) => row.totalPaid)), [data])

  return (
    <AppShell breadcrumb="Immo" section="Rapports">
      <section className="page-heading">
        <div><p className="eyebrow">IMMO</p><h1>Rapports <span>mensuels</span></h1><p className="heading-subtitle">Loyers, recouvrement et dépenses, mois par mois.</p></div>
        <div className="filter-row">
          <label className="select-wrap">
            <span className="sr-only">Mois</span>
            <select value={period ?? ''} onChange={(event) => setPeriod(event.target.value)}>
              {(data?.availablePeriods ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <ChevronDown />
          </label>
          <div className="export-group">
            <button className="btn-secondary" disabled={!data} onClick={() => data && exportImmoReportPdf(data)}><Download size={13} /> PDF</button>
            <button className="btn-secondary" disabled={!data} onClick={() => data && exportImmoReportExcel(data)}><FileSpreadsheet size={13} /> Excel</button>
          </div>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs rapport Immo">
        <MetricCard label="Loyers encaissés" value={data ? data.rentCollectedFormatted : '—'} icon={Wallet} tone="green" />
        <MetricCard label="Taux de recouvrement" value={data ? `${data.collectionRate} %` : '—'} icon={Percent} tone="blue" />
        <MetricCard label="Résultat net" value={data ? data.netFormatted : '—'} icon={TrendingUp} tone={data && data.net < 0 ? 'orange' : 'navy'} />
        <MetricCard label="Taux d'occupation" value={data ? `${data.occupancyRate} %` : '—'} icon={Percent} tone="orange" />
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2 className="section-title">Dépenses par catégorie</h2><p className="section-subtitle">Mois sélectionné</p></div></div>
          <div>
            {(data?.expensesByCategory ?? []).map((row) => (
              <RankBar key={row.category} label={row.category} value={row.amount} formatted={row.amountFormatted} max={maxExpense} color="var(--orange)" />
            ))}
            {!loading && (data?.expensesByCategory.length ?? 0) === 0 && <p className="table-empty">Aucune dépense ce mois.</p>}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h2 className="section-title">Top locataires</h2><p className="section-subtitle">Par encaissé au total (cumul)</p></div></div>
          <div>
            {(data?.topTenants ?? []).map((row) => (
              <RankBar key={row.id} label={row.name} value={row.totalPaid} formatted={row.totalPaidFormatted} max={maxTenant} color="var(--primary)" href={`/immo/locataires/${row.id}`} />
            ))}
            {!loading && (data?.topTenants.length ?? 0) === 0 && <p className="table-empty">Aucun locataire avec un loyer encaissé.</p>}
          </div>
        </article>
      </section>
    </AppShell>
  )
}
