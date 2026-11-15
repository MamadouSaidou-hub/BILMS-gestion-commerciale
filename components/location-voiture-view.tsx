'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Banknote, Car, CheckCircle2, FileText, Fuel, Pencil, Plus, ReceiptText, RefreshCw, TrendingDown, TrendingUp, Trash2, Wallet } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

type Vehicle = { id: number; name: string; plate: string; dailyRate: number; dailyRateFormatted: string; status: 'available' | 'rented' | 'maintenance'; notes: string | null }
type Rental = {
  id: number
  vehicleId: number
  vehicleName: string
  clientId: number
  clientName: string
  clientPhone: string | null
  startDate: string
  plannedEndDate: string
  endDate: string | null
  daysRemaining: number | null
  days: number
  dailyRate: number
  dailyRateFormatted: string
  totalAmount: number
  totalAmountFormatted: string
  amountPaidFormatted: string
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  status: 'active' | 'completed' | 'cancelled'
  notes: string | null
  departureCity: string | null
  destinationCity: string | null
}
type Expense = { id: number; vehicleId: number | null; vehicleName: string; date: string; category: string; amount: number; amountFormatted: string; notes: string | null }
type RentalClientOption = { id: number; name: string; phone: string }
type Summary = {
  totalCollectedFormatted: string
  totalExpensesFormatted: string
  netFormatted: string
  net: number
  availableCount: number
  rentedCount: number
  maintenanceCount: number
  activeRentalsCount: number
}
type Data = { vehicles: Vehicle[]; rentals: Rental[]; upcomingDeadlines: Rental[]; expenses: Expense[]; summary: Summary }

const statusLabel = { available: 'Disponible', rented: 'En location', maintenance: 'En entretien' }
const statusBadge = { available: 'badge-green', rented: 'badge-blue', maintenance: 'badge-orange' }
const paymentLabel = { paid: 'Payée', partial: 'Partielle', unpaid: 'Non payée' }
const paymentBadge = { paid: 'badge-green', partial: 'badge-orange', unpaid: 'badge-red' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Car; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewVehicleForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [plate, setPlate] = useState('')
  const [dailyRate, setDailyRate] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/vehicules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, plate, dailyRate }),
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
      <div className="form-field"><label>Véhicule</label><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Toyota Corolla" /></div>
      <div className="form-row">
        <div className="form-field"><label>Immatriculation</label><input required value={plate} onChange={(event) => setPlate(event.target.value)} /></div>
        <div className="form-field"><label>Tarif journalier (GNF)</label><input required type="number" min="1" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Ajouter le véhicule'}</button></div>
    </form>
  )
}

type ChargeRow = { description: string; unit: string; quantity: string; unitPrice: string }

function NewRentalForm({ vehicle, clientOptions, onCreated }: { vehicle: Vehicle; clientOptions: RentalClientOption[]; onCreated: () => void }) {
  const [creatingClient, setCreatingClient] = useState(clientOptions.length === 0)
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [days, setDays] = useState('1')
  const [dailyRate, setDailyRate] = useState(String(vehicle.dailyRate))
  const [departureCity, setDepartureCity] = useState('')
  const [destinationCity, setDestinationCity] = useState('')
  const [charges, setCharges] = useState<ChargeRow[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function addChargeRow() {
    setCharges((rows) => [...rows, { description: '', unit: '', quantity: '1', unitPrice: '' }])
  }

  function updateChargeRow(index: number, patch: Partial<ChargeRow>) {
    setCharges((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeChargeRow(index: number) {
    setCharges((rows) => rows.filter((_, i) => i !== index))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!creatingClient && !clientId) {
      setError('Choisissez un client ou créez-en un nouveau.')
      return
    }
    setSubmitting(true)
    try {
      const dailyRateOverride = Number(dailyRate) !== vehicle.dailyRate ? dailyRate : undefined
      const commonFields = { startDate, days, dailyRateOverride, departureCity, destinationCity, charges }
      const res = await fetch(`/api/vehicules/${vehicle.id}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creatingClient ? { clientName, clientPhone, ...commonFields } : { clientId, ...commonFields }),
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
      <p className="section-subtitle">Tarif journalier habituel : <strong>{vehicle.dailyRateFormatted}</strong></p>
      <div className="form-field">
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Client</span>
          {clientOptions.length > 0 && (
            <button type="button" className="item-add-link" style={{ fontSize: 11 }} onClick={() => setCreatingClient((value) => !value)}>
              {creatingClient ? 'Choisir un client existant' : '+ Nouveau client'}
            </button>
          )}
        </label>
        {creatingClient ? (
          <div className="form-row" style={{ marginTop: 6 }}>
            <input required placeholder="Nom du client" value={clientName} onChange={(event) => setClientName(event.target.value)} />
            <input placeholder="Téléphone (optionnel)" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} />
          </div>
        ) : (
          <select required value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Sélectionner...</option>
            {clientOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.phone !== '—' ? ` — ${option.phone}` : ''}</option>)}
          </select>
        )}
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date de début</label><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="form-field"><label>Durée (jours)</label><input required type="number" min="1" value={days} onChange={(event) => setDays(event.target.value)} /></div>
      </div>
      <div className="form-field">
        <label>Tarif journalier pour cette location (GNF)</label>
        <input required type="number" min="1" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-field"><label>Ville de départ (optionnel)</label><input value={departureCity} onChange={(event) => setDepartureCity(event.target.value)} /></div>
        <div className="form-field"><label>Ville d’arrivée (optionnel)</label><input value={destinationCity} onChange={(event) => setDestinationCity(event.target.value)} /></div>
      </div>

      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Frais additionnels (optionnel)</label>
      {charges.map((charge, index) => (
        <div key={index} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <div className="form-row">
            <div className="form-field"><input required placeholder="Ex : Carburant" value={charge.description} onChange={(event) => updateChargeRow(index, { description: event.target.value })} /></div>
            <button type="button" className="item-row-remove" onClick={() => removeChargeRow(index)} aria-label="Retirer la ligne"><Trash2 size={14} /></button>
          </div>
          <div className="item-row-grid">
            <div className="form-field" style={{ marginBottom: 0 }}><input placeholder="Unité (ex : litres)" value={charge.unit} onChange={(event) => updateChargeRow(index, { unit: event.target.value })} /></div>
            <div className="form-field" style={{ marginBottom: 0 }}><input required type="number" min="0.01" step="0.01" placeholder="Qté" value={charge.quantity} onChange={(event) => updateChargeRow(index, { quantity: event.target.value })} /></div>
            <div className="form-field" style={{ marginBottom: 0 }}><input required type="number" min="1" placeholder="Prix unitaire" value={charge.unitPrice} onChange={(event) => updateChargeRow(index, { unitPrice: event.target.value })} /></div>
          </div>
        </div>
      ))}
      <button type="button" className="item-add-link" onClick={addChargeRow}><Plus size={13} /> Ajouter des frais (carburant, route...)</button>

      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer la location'}</button></div>
    </form>
  )
}

function CloseRentalForm({ rental, onDone }: { rental: Rental; onDone: () => void }) {
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locations-voiture/${rental.id}/cloturer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endDate }),
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
      <div className="form-field"><label>Date de retour</label><input required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Clôture...' : 'Clôturer la location'}</button></div>
    </form>
  )
}

function RenewRentalForm({ rental, onDone }: { rental: Rental; onDone: () => void }) {
  const [days, setDays] = useState('1')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locations-voiture/${rental.id}/renouveler`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, date: date || undefined }),
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
      <p className="section-subtitle">Fin prévue actuelle : <strong>{rental.plannedEndDate}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Jours supplémentaires</label><input required type="number" min="1" value={days} onChange={(event) => setDays(event.target.value)} /></div>
        <div className="form-field"><label>Date du renouvellement</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Renouvellement...' : 'Renouveler la location'}</button></div>
    </form>
  )
}

type RentalPaymentRow = { id: number; amount: number; amountFormatted: string; date: string | null; effectiveDate: string }

/** The rental's payment history, with per-payment correction/removal. Lives inside the payment
 * modal: it's where an admin already is when they notice a wrong amount or date. */
function RentalPaymentHistory({ rentalId, refreshKey, onChanged }: { rentalId: number; refreshKey: number; onChanged: () => void }) {
  const [payments, setPayments] = useState<RentalPaymentRow[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchJson<{ rental: { payments: RentalPaymentRow[] } }>(`/api/locations-voiture/${rentalId}`)
      .then((json) => {
        if (!cancelled) setPayments(json.rental.payments ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [rentalId, refreshKey])

  async function save(id: number) {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/locations-voiture/${rentalId}/paiement/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: editAmount, date: editDate || null }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setEditingId(null)
      onChanged()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: number) {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/locations-voiture/${rentalId}/paiement/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onChanged()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setBusyId(null)
    }
  }

  if (payments.length === 0) return null

  return (
    <div style={{ marginTop: 18 }}>
      <p className="section-title">Paiements déjà enregistrés</p>
      {error && <p className="form-error">{error}</p>}
      <table className="data-table">
        <thead><tr><th>Date</th><th>Montant</th><th></th></tr></thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.id}>
              {editingId === payment.id ? (
                <>
                  <td><input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} /></td>
                  <td><input type="number" min="1" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} /></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn-ghost" disabled={busyId === payment.id} onClick={() => save(payment.id)}>Enregistrer</button>
                    <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>Annuler</button>
                  </td>
                </>
              ) : (
                <>
                  <td data-label="Date">{new Date(payment.effectiveDate).toLocaleDateString('fr-FR')}</td>
                  <td data-label="Montant">{payment.amountFormatted}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setEditingId(payment.id)
                        setEditAmount(String(payment.amount))
                        setEditDate((payment.date ?? payment.effectiveDate).slice(0, 10))
                      }}
                    >
                      <Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier
                    </button>
                    <button type="button" className="btn-ghost" disabled={busyId === payment.id} onClick={() => remove(payment.id)}>
                      <Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RentalPaymentForm({ rental, onDone }: { rental: Rental; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [historyKey, setHistoryKey] = useState(0)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locations-voiture/${rental.id}/paiement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, date: date || undefined }),
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
      <p className="section-subtitle">Total : <strong>{rental.totalAmountFormatted}</strong> · Déjà payé : <strong>{rental.amountPaidFormatted}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Montant payé (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="form-field"><label>Date du paiement</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer le paiement'}</button></div>
      <RentalPaymentHistory
        rentalId={rental.id}
        refreshKey={historyKey}
        onChanged={() => {
          setHistoryKey((key) => key + 1)
          onDone()
        }}
      />
    </form>
  )
}

function AddRentalChargeForm({ rental, onDone }: { rental: Rental; onDone: () => void }) {
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locations-voiture/${rental.id}/frais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, unit, quantity, unitPrice, date: date || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setDescription('')
      setUnit('')
      setQuantity('1')
      setUnitPrice('')
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
      <p className="section-subtitle">Ajoutez une ligne de frais à la facture (carburant, frais de route...).</p>
      <div className="form-field"><label>Description</label><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex : Carburant" /></div>
      <div className="form-row">
        <div className="form-field"><label>Unité (optionnel)</label><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Ex : litres" /></div>
        <div className="form-field"><label>Quantité</label><input required type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
        <div className="form-field"><label>Prix unitaire (GNF)</label><input required type="number" min="1" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Date du frais</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Ajout...' : 'Ajouter la ligne'}</button></div>
    </form>
  )
}

function EditRentalForm({ rental, onSaved }: { rental: Rental; onSaved: () => void }) {
  const [startDate, setStartDate] = useState(rental.startDate)
  const [days, setDays] = useState(String(rental.days))
  const [dailyRate, setDailyRate] = useState(String(rental.dailyRate))
  const [notes, setNotes] = useState(rental.notes ?? '')
  const [departureCity, setDepartureCity] = useState(rental.departureCity ?? '')
  const [destinationCity, setDestinationCity] = useState(rental.destinationCity ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locations-voiture/${rental.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, days, dailyRateOverride: dailyRate, notes, departureCity, destinationCity, reason: reason || undefined }),
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
      <p className="section-subtitle">{rental.vehicleName} — {rental.clientName}</p>
      <div className="form-row">
        <div className="form-field"><label>Date de début</label><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="form-field"><label>Durée (jours)</label><input required type="number" min="1" value={days} onChange={(event) => setDays(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Tarif journalier (GNF)</label><input required type="number" min="1" value={dailyRate} onChange={(event) => setDailyRate(event.target.value)} /></div>
      <div className="form-row">
        <div className="form-field"><label>Ville de départ (optionnel)</label><input value={departureCity} onChange={(event) => setDepartureCity(event.target.value)} /></div>
        <div className="form-field"><label>Ville d’arrivée (optionnel)</label><input value={destinationCity} onChange={(event) => setDestinationCity(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Notes (optionnel)</label><input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeleteRentalConfirm({ rental, onClose, onDone }: { rental: Rental; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locations-voiture/${rental.id}`, {
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
        Le véhicule redevient disponible si la location était active. Les frais déjà ajoutés restent enregistrés. La location
        reste visible en base (avec qui et quand) à des fins d’audit, mais disparaît des listes et des totaux.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder la location</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer la location'}</button>
      </div>
    </div>
  )
}

function NewExpenseForm({ vehicles, onCreated }: { vehicles: Vehicle[]; onCreated: () => void }) {
  const [vehicleId, setVehicleId] = useState('')
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
      const res = await fetch('/api/vehicules/depenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicleId || null, date, category, amount, notes }),
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
        <label>Véhicule concerné (optionnel)</label>
        <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
          <option value="">Dépense générale</option>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} — {vehicle.plate}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date</label><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="form-field"><label>Catégorie</label><input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex : Entretien, Assurance, Carburant" /></div>
      </div>
      <div className="form-field"><label>Montant (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div className="form-field"><label>Notes (optionnel)</label><input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer la dépense'}</button></div>
    </form>
  )
}

function EditVehicleExpenseForm({ expense, vehicles, onSaved }: { expense: Expense; vehicles: Vehicle[]; onSaved: () => void }) {
  const [vehicleId, setVehicleId] = useState(expense.vehicleId ? String(expense.vehicleId) : '')
  const [date, setDate] = useState(expense.date)
  const [category, setCategory] = useState(expense.category)
  const [amount, setAmount] = useState(String(expense.amount))
  const [notes, setNotes] = useState(expense.notes ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/vehicules/depenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicleId || null, date, category, amount, notes, reason: reason || undefined }),
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
      <div className="form-field">
        <label>Véhicule concerné (optionnel)</label>
        <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
          <option value="">Dépense générale</option>
          {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} — {vehicle.plate}</option>)}
        </select>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date</label><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="form-field"><label>Catégorie</label><input required value={category} onChange={(event) => setCategory(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Montant (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div className="form-field"><label>Notes (optionnel)</label><input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeleteVehicleExpenseConfirm({ expense, onClose, onDone }: { expense: Expense; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/vehicules/depenses/${expense.id}`, {
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
      <p className="section-subtitle">Cette dépense ({expense.amountFormatted}) reste visible en base (avec qui et quand) à des fins d’audit, mais disparaît de la liste et des totaux.</p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder la dépense</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer la dépense'}</button>
      </div>
    </div>
  )
}

export function LocationVoitureView() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clientOptions, setClientOptions] = useState<RentalClientOption[]>([])
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false)
  const [rentalVehicle, setRentalVehicle] = useState<Vehicle | null>(null)
  const [closingRental, setClosingRental] = useState<Rental | null>(null)
  const [payingRental, setPayingRental] = useState<Rental | null>(null)
  const [renewingRental, setRenewingRental] = useState<Rental | null>(null)
  const [chargingRental, setChargingRental] = useState<Rental | null>(null)
  const [editingRental, setEditingRental] = useState<Rental | null>(null)
  const [deletingRental, setDeletingRental] = useState<Rental | null>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null)
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<Data>('/api/vehicules')
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
    fetchJson<{ clients: RentalClientOption[] }>('/api/clients-location').then((json) => setClientOptions(json.clients)).catch(() => {})
  }, [refreshKey])

  const availableCount = useMemo(() => (data?.vehicles ?? []).filter((v) => v.status === 'available').length, [data])

  return (
    <AppShell breadcrumb="Location voiture" section="Véhicules">
      <section className="page-heading">
        <div><p className="eyebrow">LOCATION VOITURE</p><h1>Véhicules <span>et locations</span></h1><p className="heading-subtitle">Suivez la flotte, les locations en cours et les paiements.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs location voiture">
        <MetricCard label="Total encaissé" value={data?.summary.totalCollectedFormatted ?? '—'} icon={Banknote} tone="green" />
        <MetricCard label="Total dépenses" value={data?.summary.totalExpensesFormatted ?? '—'} icon={TrendingDown} tone="orange" />
        <MetricCard label="Résultat net" value={data?.summary.netFormatted ?? '—'} icon={TrendingUp} tone={data && data.summary.net < 0 ? 'orange' : 'navy'} />
        <MetricCard label="Locations actives" value={data ? `${data.summary.activeRentalsCount}` : '—'} icon={Car} tone="blue" />
      </section>

      {(data?.upcomingDeadlines ?? []).length > 0 && (
        <section className="table-panel" style={{ marginBottom: 20, borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', fontWeight: 700, color: 'var(--orange)' }}>
            <AlertTriangle size={15} /> Échéances à venir (7 prochains jours)
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Véhicule</th><th>Client</th><th>Retour prévu</th><th></th></tr></thead>
              <tbody>
                {(data?.upcomingDeadlines ?? []).map((rental) => (
                  <tr key={rental.id}>
                    <td data-label="Véhicule">{rental.vehicleName}</td>
                    <td data-label="Client">{rental.clientName}</td>
                    <td data-label="Retour prévu">{rental.plannedEndDate} {rental.daysRemaining !== null && (rental.daysRemaining <= 0 ? <span className="badge badge-red">En retard</span> : <span className="badge badge-orange">Dans {rental.daysRemaining} j</span>)}</td>
                    <td><button className="btn-ghost" onClick={() => setRenewingRental(rental)}><RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Renouveler</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="toolbar-panel">
        <p className="heading-subtitle">{availableCount} véhicule(s) disponible(s)</p>
        <button className="btn-primary" onClick={() => setVehicleModalOpen(true)}><Plus size={14} /> Nouveau véhicule</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Véhicule</th><th>Immatriculation</th><th>Tarif/jour</th><th>Statut</th><th></th></tr>
            </thead>
            <tbody>
              {(data?.vehicles ?? []).map((vehicle) => (
                <tr key={vehicle.id}>
                  <td data-label="Véhicule"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Car size={13} color="var(--faint)" />{vehicle.name}</span></td>
                  <td data-label="Immatriculation">{vehicle.plate}</td>
                  <td data-label="Tarif/jour">{vehicle.dailyRateFormatted}</td>
                  <td data-label="Statut"><span className={`badge ${statusBadge[vehicle.status]}`}>{statusLabel[vehicle.status]}</span></td>
                  <td>{vehicle.status === 'available' && <button className="btn-ghost" onClick={() => setRentalVehicle(vehicle)}>Louer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.vehicles ?? []).length === 0 && <p className="table-empty">Aucun véhicule enregistré.</p>}
        </div>
      </div>

      <section className="page-heading" style={{ marginTop: 32 }}>
        <div><h1 style={{ fontSize: 18 }}>Locations</h1></div>
      </section>
      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Véhicule</th><th>Client</th><th>Trajet</th><th>Début</th><th>Fin prévue</th><th>Retour réel</th><th>Montant</th><th>Paiement</th><th></th></tr>
            </thead>
            <tbody>
              {(data?.rentals ?? []).map((rental) => (
                <tr key={rental.id}>
                  <td data-label="Véhicule">{rental.vehicleName}</td>
                  <td data-label="Client"><Link href={`/location-voiture/clients/${rental.clientId}`}>{rental.clientName}</Link></td>
                  <td data-label="Trajet">{rental.departureCity || rental.destinationCity ? `${rental.departureCity ?? '—'} → ${rental.destinationCity ?? '—'}` : '—'}</td>
                  <td data-label="Début">{rental.startDate}</td>
                  <td data-label="Fin prévue">{rental.plannedEndDate}</td>
                  <td data-label="Retour réel">{rental.endDate ?? '—'}</td>
                  <td data-label="Montant">{rental.totalAmountFormatted}</td>
                  <td data-label="Paiement"><span className={`badge ${paymentBadge[rental.paymentStatus]}`}>{paymentLabel[rental.paymentStatus]}</span></td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {rental.paymentStatus !== 'paid' && <button className="btn-ghost" onClick={() => setPayingRental(rental)}><Wallet size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Payer</button>}
                    {rental.status === 'active' && <button className="btn-ghost" onClick={() => setRenewingRental(rental)}><RefreshCw size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Renouveler</button>}
                    {rental.status === 'active' && <button className="btn-ghost" onClick={() => setClosingRental(rental)}><CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Clôturer</button>}
                    <button className="btn-ghost" onClick={() => setChargingRental(rental)}><Fuel size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Frais</button>
                    <Link className="btn-ghost" href={`/location-voiture/${rental.id}/facture`} target="_blank"><FileText size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Facture</Link>
                    <button className="btn-ghost" onClick={() => setEditingRental(rental)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                    <button className="btn-ghost" onClick={() => setDeletingRental(rental)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.rentals ?? []).length === 0 && <p className="table-empty">Aucune location enregistrée.</p>}
        </div>
      </div>

      <section className="page-heading" style={{ marginTop: 32 }}>
        <div><h1 style={{ fontSize: 18 }}>Dépenses</h1></div>
      </section>
      <div className="toolbar-panel">
        <p className="heading-subtitle">Entretien, assurance, carburant...</p>
        <button className="btn-primary" onClick={() => setExpenseModalOpen(true)}><ReceiptText size={14} /> Nouvelle dépense</button>
      </div>
      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Véhicule</th><th>Catégorie</th><th>Montant</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {(data?.expenses ?? []).map((expense) => (
                <tr key={expense.id}>
                  <td data-label="Date">{expense.date}</td>
                  <td data-label="Véhicule">{expense.vehicleName}</td>
                  <td data-label="Catégorie">{expense.category}</td>
                  <td data-label="Montant">{expense.amountFormatted}</td>
                  <td data-label="Notes">{expense.notes ?? '—'}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn-ghost" onClick={() => setEditingExpense(expense)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                    <button className="btn-ghost" onClick={() => setDeletingExpense(expense)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.expenses ?? []).length === 0 && <p className="table-empty">Aucune dépense enregistrée.</p>}
        </div>
      </div>

      <Modal open={vehicleModalOpen} onClose={() => setVehicleModalOpen(false)} title="Nouveau véhicule" subtitle="Ajoutez un véhicule à la flotte.">
        <NewVehicleForm onCreated={() => { setVehicleModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
      <Modal open={rentalVehicle !== null} onClose={() => setRentalVehicle(null)} title={`Nouvelle location — ${rentalVehicle?.name ?? ''}`} subtitle="Créez une location pour ce véhicule.">
        {rentalVehicle && <NewRentalForm vehicle={rentalVehicle} clientOptions={clientOptions} onCreated={() => { setRentalVehicle(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={closingRental !== null} onClose={() => setClosingRental(null)} title="Clôturer la location" subtitle="Enregistrez le retour du véhicule.">
        {closingRental && <CloseRentalForm rental={closingRental} onDone={() => { setClosingRental(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={payingRental !== null} onClose={() => setPayingRental(null)} title="Enregistrer un paiement" subtitle="">
        {payingRental && <RentalPaymentForm rental={payingRental} onDone={() => { setPayingRental(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={renewingRental !== null} onClose={() => setRenewingRental(null)} title="Renouveler la location" subtitle="">
        {renewingRental && <RenewRentalForm rental={renewingRental} onDone={() => { setRenewingRental(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={chargingRental !== null} onClose={() => setChargingRental(null)} title="Ajouter une ligne de frais" subtitle={chargingRental ? `${chargingRental.vehicleName} — ${chargingRental.clientName}` : ''}>
        {chargingRental && <AddRentalChargeForm rental={chargingRental} onDone={() => setRefreshKey((key) => key + 1)} />}
      </Modal>
      <Modal open={editingRental !== null} onClose={() => setEditingRental(null)} title="Modifier la location" subtitle="">
        {editingRental && <EditRentalForm rental={editingRental} onSaved={() => { setEditingRental(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={deletingRental !== null} onClose={() => setDeletingRental(null)} title="Supprimer cette location ?" subtitle="">
        {deletingRental && (
          <DeleteRentalConfirm
            rental={deletingRental}
            onClose={() => setDeletingRental(null)}
            onDone={() => { setDeletingRental(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
      <Modal open={expenseModalOpen} onClose={() => setExpenseModalOpen(false)} title="Nouvelle dépense" subtitle="Entretien, assurance, carburant...">
        <NewExpenseForm vehicles={data?.vehicles ?? []} onCreated={() => { setExpenseModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
      <Modal open={editingExpense !== null} onClose={() => setEditingExpense(null)} title="Modifier la dépense" subtitle="">
        {editingExpense && (
          <EditVehicleExpenseForm
            expense={editingExpense}
            vehicles={data?.vehicles ?? []}
            onSaved={() => { setEditingExpense(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
      <Modal open={deletingExpense !== null} onClose={() => setDeletingExpense(null)} title="Supprimer cette dépense ?" subtitle="">
        {deletingExpense && (
          <DeleteVehicleExpenseConfirm
            expense={deletingExpense}
            onClose={() => setDeletingExpense(null)}
            onDone={() => { setDeletingExpense(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
    </AppShell>
  )
}
