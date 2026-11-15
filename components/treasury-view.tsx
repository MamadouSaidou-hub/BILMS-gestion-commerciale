'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, CreditCard, Pencil, PiggyBank, Plus, Trash2, Truck, Wallet, WalletCards } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'
import { PeriodFilter, usePeriodFilter } from '@/components/period-filter'

type PaymentRow = {
  id: number
  date: string
  ownDate: string | null
  client: string
  clientId: number
  store: string
  storeId: number
  amount: number
  amountFormatted: string
  method: 'cash' | 'mobile_money' | 'bank_transfer' | 'check'
  editable: boolean
}
type TreasuryData = {
  payments: PaymentRow[]
  summary: {
    totalEncaisse: string
    cashSales: string
    totalPayments: string
    outstandingReceivables: string
    totalSupplierPayments: string
    outstandingPayables: string
  }
  stores: string[]
}
type StoreOption = { id: number; name: string }
type ClientOption = { id: number; name: string }

const methodLabel = { cash: 'Espèces', mobile_money: 'Mobile Money', bank_transfer: 'Virement', check: 'Chèque' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Wallet; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewPaymentForm({ storeOptions, clientOptions, onCreated }: { storeOptions: StoreOption[]; clientOptions: ClientOption[]; onCreated: () => void }) {
  const [clientId, setClientId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'mobile_money' | 'bank_transfer' | 'check'>('cash')
  const [storeId, setStoreId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])
  useEffect(() => {
    if (!clientId && clientOptions.length > 0) setClientId(String(clientOptions[0].id))
  }, [clientOptions, clientId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/tresorerie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, amount, method, storeId, date: date || undefined }),
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
        <label>Client</label>
        <select required value={clientId} onChange={(event) => setClientId(event.target.value)}>
          {clientOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Montant (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="form-field">
          <label>Méthode</label>
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="cash">Espèces</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="bank_transfer">Virement</option>
            <option value="check">Chèque</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Magasin d’encaissement</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field"><label>Date d’encaissement</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer l’encaissement'}</button></div>
    </form>
  )
}

function EditPaymentForm({ payment, storeOptions, onSaved }: { payment: PaymentRow; storeOptions: StoreOption[]; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(payment.amount))
  const [method, setMethod] = useState(payment.method)
  const [storeId, setStoreId] = useState(String(payment.storeId))
  const [date, setDate] = useState((payment.ownDate ?? '').slice(0, 10))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/tresorerie/${payment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method, storeId, date: date || null, reason: reason || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onSaved()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <p className="section-subtitle">Client : <strong>{payment.client}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Montant (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="form-field">
          <label>Méthode</label>
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="cash">Espèces</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="bank_transfer">Virement</option>
            <option value="check">Chèque</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Magasin d’encaissement</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field"><label>Date d’encaissement</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeletePaymentConfirm({ payment, onClose, onDone }: { payment: PaymentRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/tresorerie/${payment.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || undefined }),
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
    <div>
      {error && <p className="form-error">{error}</p>}
      <p className="section-subtitle">
        La créance que ce paiement avait réglée sera rouverte pour le montant correspondant. Le paiement reste visible
        en base (avec qui et quand) à des fins d’audit, mais disparaît de la liste et des totaux.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder le paiement</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer le paiement'}</button>
      </div>
    </div>
  )
}

export function TreasuryView() {
  const periodFilter = usePeriodFilter()
  const [store, setStore] = useState('Tous les magasins')
  const [data, setData] = useState<TreasuryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<PaymentRow | null>(null)
  const [deletingPayment, setDeletingPayment] = useState<PaymentRow | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const { period, isCustom, customFrom, customTo, ready: periodReady, params: periodParams } = periodFilter

  useEffect(() => {
    if (!periodReady) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchJson<TreasuryData>(`/api/tresorerie?${periodParams({ store }).toString()}`)
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur inconnue.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, isCustom, customFrom, customTo, periodReady, store, refreshKey])

  useEffect(() => {
    fetchJson<{ stores: StoreOption[] }>('/api/magasins').then((json) => setStoreOptions(json.stores)).catch(() => {})
    fetchJson<{ clients: ClientOption[] }>('/api/clients/options').then((json) => setClientOptions(json.clients)).catch(() => {})
  }, [refreshKey])

  const stores = data?.stores ?? ['Tous les magasins']

  return (
    <AppShell breadcrumb="Pilotage" section="Trésorerie">
      <section className="page-heading">
        <div><p className="eyebrow">ENCAISSEMENTS</p><h1>Trésorerie <span>et paiements</span></h1><p className="heading-subtitle">Suivez les encaissements et le solde des créances.</p></div>
        <div className="filter-row">
          <PeriodFilter state={periodFilter} />
          <label className="select-wrap"><span className="sr-only">Magasin</span><select value={store} onChange={(event) => setStore(event.target.value)}>{stores.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs trésorerie">
        <MetricCard label="Total encaissé" value={data ? data.summary.totalEncaisse : '—'} icon={WalletCards} tone="navy" />
        <MetricCard label="Ventes comptant" value={data ? data.summary.cashSales : '—'} icon={Wallet} tone="green" />
        <MetricCard label="Paiements de créances" value={data ? data.summary.totalPayments : '—'} icon={CreditCard} tone="blue" />
        <MetricCard label="Solde créances" value={data ? data.summary.outstandingReceivables : '—'} icon={PiggyBank} tone="orange" />
        <MetricCard label="Payé au fournisseur" value={data ? data.summary.totalSupplierPayments : '—'} icon={Truck} tone="blue" />
        <MetricCard label="Dû au fournisseur" value={data ? data.summary.outstandingPayables : '—'} icon={Truck} tone="orange" />
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-spacer" />
        <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} /> Nouvel encaissement</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Magasin</th>
                <th>Méthode</th>
                <th>Montant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.payments ?? []).map((payment) => (
                <tr key={payment.id}>
                  <td>{new Date(payment.date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{payment.client}</td>
                  <td>{payment.store}</td>
                  <td>{methodLabel[payment.method]}</td>
                  <td>{payment.amountFormatted}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {payment.editable && (
                      <>
                        <button className="btn-ghost" onClick={() => setEditingPayment(payment)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                        <button className="btn-ghost" onClick={() => setDeletingPayment(payment)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.payments.length ?? 0) === 0 && <p className="table-empty">Aucun paiement enregistré sur cette période.</p>}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvel encaissement" subtitle="Enregistrez un paiement reçu d’un client.">
        <NewPaymentForm
          storeOptions={storeOptions}
          clientOptions={clientOptions}
          onCreated={() => { setModalOpen(false); setRefreshKey((key) => key + 1) }}
        />
      </Modal>
      <Modal open={editingPayment !== null} onClose={() => setEditingPayment(null)} title="Modifier l’encaissement" subtitle="">
        {editingPayment && (
          <EditPaymentForm
            payment={editingPayment}
            storeOptions={storeOptions}
            onSaved={() => { setEditingPayment(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
      <Modal open={deletingPayment !== null} onClose={() => setDeletingPayment(null)} title="Supprimer cet encaissement ?" subtitle="">
        {deletingPayment && (
          <DeletePaymentConfirm
            payment={deletingPayment}
            onClose={() => setDeletingPayment(null)}
            onDone={() => { setDeletingPayment(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
    </AppShell>
  )
}
