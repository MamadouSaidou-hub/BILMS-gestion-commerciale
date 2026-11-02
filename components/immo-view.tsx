'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Banknote, Building2, CheckCircle2, FileText, Home, Plus, ReceiptText, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

type Payment = { id: number; period: string; status: 'paid' | 'late' | 'unpaid'; amountFormatted: string }
type ActiveLease = { id: number; tenantName: string; tenantPhone: string | null; startDate: string; endDate: string; daysRemaining: number; payments: Payment[] }
type Unit = { id: number; label: string; floor: number; monthlyRentFormatted: string; status: 'vacant' | 'occupied'; activeLease: ActiveLease | null }
type Building = { id: number; name: string; address: string; units: Unit[] }
type Deadline = { leaseId: number; unitLabel: string; buildingName: string; tenantName: string; endDate: string; daysRemaining: number }
type Expense = { id: number; buildingId: number | null; buildingName: string; date: string; category: string; amountFormatted: string; notes: string | null }
type Summary = {
  rentCollectedFormatted: string
  totalExpensesFormatted: string
  netFormatted: string
  net: number
  unitsTotal: number
  occupiedCount: number
  vacantCount: number
  occupancyRate: number
}
type Data = { buildings: Building[]; upcomingDeadlines: Deadline[]; expenses: Expense[]; summary: Summary }

const rentStatusLabel = { paid: 'Payé', late: 'En retard', unpaid: 'Non payé' }
const rentStatusBadge = { paid: 'badge-green', late: 'badge-red', unpaid: 'badge-orange' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Building2; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function NewBuildingForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/immeubles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onCreated()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-field"><label>Immeuble</label><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Immeuble A" /></div>
      <div className="form-field"><label>Adresse</label><input required value={address} onChange={(event) => setAddress(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Ajouter l’immeuble'}</button></div>
    </form>
  )
}

function NewUnitForm({ building, onCreated }: { building: Building; onCreated: () => void }) {
  const [label, setLabel] = useState('')
  const [floor, setFloor] = useState('0')
  const [monthlyRent, setMonthlyRent] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/immeubles/${building.id}/logements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, floor, monthlyRent }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onCreated()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-row">
        <div className="form-field"><label>Logement</label><input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex : Appt 201" /></div>
        <div className="form-field"><label>Étage</label><input required type="number" min="0" value={floor} onChange={(event) => setFloor(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Loyer mensuel (GNF)</label><input required type="number" min="1" value={monthlyRent} onChange={(event) => setMonthlyRent(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Ajouter le logement'}</button></div>
    </form>
  )
}

function NewLeaseForm({ unit, onCreated }: { unit: Unit; onCreated: () => void }) {
  const [tenantName, setTenantName] = useState('')
  const [tenantPhone, setTenantPhone] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [months, setMonths] = useState('12')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/logements/${unit.id}/bail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantName, tenantPhone, startDate, months }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onCreated()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <p className="section-subtitle">Loyer : <strong>{unit.monthlyRentFormatted}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Locataire</label><input required value={tenantName} onChange={(event) => setTenantName(event.target.value)} /></div>
        <div className="form-field"><label>Téléphone</label><input value={tenantPhone} onChange={(event) => setTenantPhone(event.target.value)} placeholder="6XX XX XX XX" /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date d’entrée</label><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="form-field"><label>Durée du bail (mois)</label><input required type="number" min="1" value={months} onChange={(event) => setMonths(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer le bail'}</button></div>
    </form>
  )
}

function RenewLeaseForm({ leaseId, currentEndDate, onDone }: { leaseId: number; currentEndDate: string; onDone: () => void }) {
  const [months, setMonths] = useState('12')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/baux/${leaseId}/renouveler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onDone()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <p className="section-subtitle">Fin actuelle : <strong>{currentEndDate}</strong></p>
      <div className="form-field"><label>Mois supplémentaires</label><input required type="number" min="1" value={months} onChange={(event) => setMonths(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Renouvellement...' : 'Renouveler le bail'}</button></div>
    </form>
  )
}

function NewBuildingExpenseForm({ buildings, onCreated }: { buildings: Building[]; onCreated: () => void }) {
  const [buildingId, setBuildingId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/immeubles/depenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingId: buildingId || null, date, category, amount, notes }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onCreated()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-field">
        <label>Immeuble concerné (optionnel)</label>
        <select value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
          <option value="">Dépense générale</option>
          {buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date</label><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="form-field"><label>Catégorie</label><input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex : Plomberie, Électricité, Taxes" /></div>
      </div>
      <div className="form-field"><label>Montant (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div className="form-field"><label>Notes (optionnel)</label><input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer la dépense'}</button></div>
    </form>
  )
}

export function ImmoView() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [buildingModalOpen, setBuildingModalOpen] = useState(false)
  const [unitBuilding, setUnitBuilding] = useState<Building | null>(null)
  const [leaseUnit, setLeaseUnit] = useState<Unit | null>(null)
  const [renewingLease, setRenewingLease] = useState<{ id: number; endDate: string } | null>(null)
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<Data>('/api/immeubles')
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const period = currentPeriod()

  async function endLease(leaseId: number) {
    await fetch(`/api/baux/${leaseId}/terminer`, { method: 'POST' })
    setRefreshKey((key) => key + 1)
  }

  async function setRentStatus(leaseId: number, status: 'paid' | 'late' | 'unpaid') {
    await fetch(`/api/baux/${leaseId}/loyers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, status }),
    })
    setRefreshKey((key) => key + 1)
  }

  return (
    <AppShell breadcrumb="Immo" section="Immeubles">
      <section className="page-heading">
        <div><p className="eyebrow">IMMO</p><h1>Immeubles <span>et locataires</span></h1><p className="heading-subtitle">Logements, baux et suivi des loyers du mois.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs immobilier">
        <MetricCard label="Loyers encaissés" value={data?.summary.rentCollectedFormatted ?? '—'} icon={Banknote} tone="green" />
        <MetricCard label="Total dépenses" value={data?.summary.totalExpensesFormatted ?? '—'} icon={TrendingDown} tone="orange" />
        <MetricCard label="Résultat net" value={data?.summary.netFormatted ?? '—'} icon={TrendingUp} tone={data && data.summary.net < 0 ? 'orange' : 'navy'} />
        <MetricCard label="Taux d'occupation" value={data ? `${data.summary.occupancyRate}% (${data.summary.occupiedCount}/${data.summary.unitsTotal})` : '—'} icon={Building2} tone="blue" />
      </section>

      {(data?.upcomingDeadlines ?? []).length > 0 && (
        <section className="table-panel" style={{ marginBottom: 20, borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', fontWeight: 700, color: 'var(--orange)' }}>
            <AlertTriangle size={15} /> Échéances à venir (7 prochains jours)
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Logement</th><th>Locataire</th><th>Fin de bail</th><th></th></tr></thead>
              <tbody>
                {(data?.upcomingDeadlines ?? []).map((deadline) => (
                  <tr key={deadline.leaseId}>
                    <td data-label="Logement">{deadline.buildingName} — {deadline.unitLabel}</td>
                    <td data-label="Locataire">{deadline.tenantName}</td>
                    <td data-label="Fin de bail">{deadline.endDate} {deadline.daysRemaining <= 0 ? <span className="badge badge-red">En retard</span> : <span className="badge badge-orange">Dans {deadline.daysRemaining} j</span>}</td>
                    <td><button className="btn-ghost" onClick={() => setRenewingLease({ id: deadline.leaseId, endDate: deadline.endDate })}><RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Renouveler</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="toolbar-panel">
        <p className="heading-subtitle">Période en cours : {period}</p>
        <button className="btn-primary" onClick={() => setBuildingModalOpen(true)}><Plus size={14} /> Nouvel immeuble</button>
      </div>

      {(data?.buildings ?? []).map((building) => (
        <div key={building.id} className="table-panel" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}><Building2 size={15} />{building.name} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— {building.address}</span></span>
            <button className="btn-ghost" onClick={() => setUnitBuilding(building)}><Plus size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Logement</button>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Logement</th><th>Étage</th><th>Loyer</th><th>Statut</th><th>Locataire</th><th>Fin de bail</th><th>Loyer {period}</th><th></th></tr>
              </thead>
              <tbody>
                {building.units.map((unit) => (
                  <tr key={unit.id}>
                    <td data-label="Logement"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Home size={13} color="var(--faint)" />{unit.label}</span></td>
                    <td data-label="Étage">{unit.floor}</td>
                    <td data-label="Loyer">{unit.monthlyRentFormatted}</td>
                    <td data-label="Statut"><span className={`badge ${unit.status === 'occupied' ? 'badge-blue' : 'badge-green'}`}>{unit.status === 'occupied' ? 'Occupé' : 'Vacant'}</span></td>
                    <td data-label="Locataire">{unit.activeLease?.tenantName ?? '—'}</td>
                    <td data-label="Fin de bail">{unit.activeLease?.endDate ?? '—'}</td>
                    <td data-label={`Loyer ${period}`}>
                      {unit.activeLease ? (() => {
                        const payment = unit.activeLease.payments.find((p) => p.period === period)
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className={`badge ${rentStatusBadge[payment?.status ?? 'unpaid']}`}>{rentStatusLabel[payment?.status ?? 'unpaid']}</span>
                            {payment?.status === 'paid' && (
                              <Link href={`/immo/quittances/${payment.id}`} target="_blank" title="Quittance"><FileText size={13} color="var(--faint)" /></Link>
                            )}
                          </span>
                        )
                      })() : '—'}
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!unit.activeLease && <button className="btn-ghost" onClick={() => setLeaseUnit(unit)}>Louer</button>}
                      {unit.activeLease && (
                        <>
                          <button className="btn-ghost" onClick={() => setRentStatus(unit.activeLease!.id, 'paid')}><CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Marquer payé</button>
                          <button className="btn-ghost" onClick={() => setRentStatus(unit.activeLease!.id, 'late')}>En retard</button>
                          <button className="btn-ghost" onClick={() => setRenewingLease({ id: unit.activeLease!.id, endDate: unit.activeLease!.endDate })}><RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Renouveler</button>
                          <button className="btn-ghost" onClick={() => endLease(unit.activeLease!.id)}>Terminer le bail</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {building.units.length === 0 && <p className="table-empty">Aucun logement.</p>}
          </div>
        </div>
      ))}
      {!loading && (data?.buildings ?? []).length === 0 && <p className="table-empty">Aucun immeuble enregistré.</p>}

      <section className="page-heading" style={{ marginTop: 32 }}>
        <div><h1 style={{ fontSize: 18 }}>Dépenses</h1></div>
      </section>
      <div className="toolbar-panel">
        <p className="heading-subtitle">Entretien, réparations, taxes...</p>
        <button className="btn-primary" onClick={() => setExpenseModalOpen(true)}><ReceiptText size={14} /> Nouvelle dépense</button>
      </div>
      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Immeuble</th><th>Catégorie</th><th>Montant</th><th>Notes</th></tr></thead>
            <tbody>
              {(data?.expenses ?? []).map((expense) => (
                <tr key={expense.id}>
                  <td data-label="Date">{expense.date}</td>
                  <td data-label="Immeuble">{expense.buildingName}</td>
                  <td data-label="Catégorie">{expense.category}</td>
                  <td data-label="Montant">{expense.amountFormatted}</td>
                  <td data-label="Notes">{expense.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.expenses ?? []).length === 0 && <p className="table-empty">Aucune dépense enregistrée.</p>}
        </div>
      </div>

      <Modal open={buildingModalOpen} onClose={() => setBuildingModalOpen(false)} title="Nouvel immeuble" subtitle="Ajoutez un immeuble.">
        <NewBuildingForm onCreated={() => { setBuildingModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
      <Modal open={unitBuilding !== null} onClose={() => setUnitBuilding(null)} title={`Nouveau logement — ${unitBuilding?.name ?? ''}`} subtitle="Ajoutez un logement à cet immeuble.">
        {unitBuilding && <NewUnitForm building={unitBuilding} onCreated={() => { setUnitBuilding(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={leaseUnit !== null} onClose={() => setLeaseUnit(null)} title={`Nouveau bail — ${leaseUnit?.label ?? ''}`} subtitle="Enregistrez un nouveau locataire.">
        {leaseUnit && <NewLeaseForm unit={leaseUnit} onCreated={() => { setLeaseUnit(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={renewingLease !== null} onClose={() => setRenewingLease(null)} title="Renouveler le bail" subtitle="">
        {renewingLease && <RenewLeaseForm leaseId={renewingLease.id} currentEndDate={renewingLease.endDate} onDone={() => { setRenewingLease(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={expenseModalOpen} onClose={() => setExpenseModalOpen(false)} title="Nouvelle dépense" subtitle="Entretien, réparations, taxes...">
        <NewBuildingExpenseForm buildings={data?.buildings ?? []} onCreated={() => { setExpenseModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
    </AppShell>
  )
}
