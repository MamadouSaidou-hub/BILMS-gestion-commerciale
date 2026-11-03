'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Download, FileSpreadsheet, Gauge, TrendingUp, Wallet } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'
import { exportLocationReportExcel, exportLocationReportPdf, type LocationReportsData } from '@/lib/export-location-report'

const periods = ['Aujourd’hui', '7 derniers jours', 'Ce mois-ci']

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

export function LocationReportsView() {
  const [period, setPeriod] = useState(periods[2])
  const [data, setData] = useState<LocationReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<LocationReportsData>(`/api/location-voiture/rapports?period=${encodeURIComponent(period)}`)
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [period, refreshKey])

  const maxExpense = useMemo(() => Math.max(1, ...(data?.expensesByCategory ?? []).map((row) => row.amount)), [data])
  const maxClient = useMemo(() => Math.max(1, ...(data?.topClients ?? []).map((row) => row.totalPaid)), [data])

  return (
    <AppShell breadcrumb="Location voiture" section="Rapports">
      <section className="page-heading">
        <div><p className="eyebrow">LOCATION VOITURE</p><h1>Rapports <span>d’activité</span></h1><p className="heading-subtitle">Locations réservées, dépenses et utilisation de la flotte sur la période.</p></div>
        <div className="filter-row">
          <label className="select-wrap">
            <span className="sr-only">Période</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map((item) => <option key={item}>{item}</option>)}</select>
            <ChevronDown />
          </label>
          <div className="export-group">
            <button className="btn-secondary" disabled={!data} onClick={() => data && exportLocationReportPdf(data, period)}><Download size={13} /> PDF</button>
            <button className="btn-secondary" disabled={!data} onClick={() => data && exportLocationReportExcel(data, period)}><FileSpreadsheet size={13} /> Excel</button>
          </div>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <p className="heading-subtitle" style={{ marginTop: -10, marginBottom: 16 }}>Les montants « réservées sur la période » se basent sur la date de réservation, pas la date d’encaissement — aucun historique de paiement par date n’existe pour les locations.</p>

      <section className="metrics-grid" aria-label="Indicateurs rapport Location voiture">
        <MetricCard label="Locations réservées" value={data ? data.totalBookedFormatted : '—'} icon={Wallet} tone="navy" />
        <MetricCard label="Dont encaissé" value={data ? data.totalCollectedInPeriodFormatted : '—'} icon={Wallet} tone="green" />
        <MetricCard label="Résultat net" value={data ? data.netFormatted : '—'} icon={TrendingUp} tone={data && data.net < 0 ? 'orange' : 'navy'} />
        <MetricCard label="Utilisation de la flotte" value={data ? `${data.fleetUtilizationRate} %` : '—'} icon={Gauge} tone="blue" />
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header"><div><h2 className="section-title">Dépenses par catégorie</h2><p className="section-subtitle">Période sélectionnée</p></div></div>
          <div>
            {(data?.expensesByCategory ?? []).map((row) => (
              <RankBar key={row.category} label={row.category} value={row.amount} formatted={row.amountFormatted} max={maxExpense} color="var(--orange)" />
            ))}
            {!loading && (data?.expensesByCategory.length ?? 0) === 0 && <p className="table-empty">Aucune dépense sur cette période.</p>}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><h2 className="section-title">Top clients</h2><p className="section-subtitle">Par encaissé au total (cumul)</p></div></div>
          <div>
            {(data?.topClients ?? []).map((row) => (
              <RankBar key={row.id} label={row.name} value={row.totalPaid} formatted={row.totalPaidFormatted} max={maxClient} color="var(--primary)" href={`/location-voiture/clients/${row.id}`} />
            ))}
            {!loading && (data?.topClients.length ?? 0) === 0 && <p className="table-empty">Aucun client avec un paiement enregistré.</p>}
          </div>
        </article>
      </section>
    </AppShell>
  )
}
