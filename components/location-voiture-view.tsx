'use client'

import { useEffect, useMemo, useState } from 'react'
import { Car, CheckCircle2, Plus, Wallet } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

type Vehicle = { id: number; name: string; plate: string; dailyRate: number; dailyRateFormatted: string; status: 'available' | 'rented' | 'maintenance'; notes: string | null }
type Rental = {
  id: number
  vehicleId: number
  vehicleName: string
  clientName: string
  clientPhone: string | null
  startDate: string
  endDate: string | null
  totalAmountFormatted: string
  amountPaidFormatted: string
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  status: 'active' | 'completed' | 'cancelled'
}
type Data = { vehicles: Vehicle[]; rentals: Rental[] }

const statusLabel = { available: 'Disponible', rented: 'En location', maintenance: 'En entretien' }
const statusBadge = { available: 'badge-green', rented: 'badge-blue', maintenance: 'badge-orange' }
const paymentLabel = { paid: 'Payée', partial: 'Partielle', unpaid: 'Non payée' }
const paymentBadge = { paid: 'badge-green', partial: 'badge-orange', unpaid: 'badge-red' }

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

function NewRentalForm({ vehicle, onCreated }: { vehicle: Vehicle; onCreated: () => void }) {
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [days, setDays] = useState('1')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/vehicules/${vehicle.id}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, clientPhone, startDate, days }),
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
      <p className="section-subtitle">Tarif journalier : <strong>{vehicle.dailyRateFormatted}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Client</label><input required value={clientName} onChange={(event) => setClientName(event.target.value)} /></div>
        <div className="form-field"><label>Téléphone</label><input value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} placeholder="6XX XX XX XX" /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date de début</label><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="form-field"><label>Durée (jours)</label><input required type="number" min="1" value={days} onChange={(event) => setDays(event.target.value)} /></div>
      </div>
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

function RentalPaymentForm({ rental, onDone }: { rental: Rental; onDone: () => void }) {
  const [amount, setAmount] = useState('')
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
        body: JSON.stringify({ amount }),
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
      <div className="form-field"><label>Montant payé (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer le paiement'}</button></div>
    </form>
  )
}

export function LocationVoitureView() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false)
  const [rentalVehicle, setRentalVehicle] = useState<Vehicle | null>(null)
  const [closingRental, setClosingRental] = useState<Rental | null>(null)
  const [payingRental, setPayingRental] = useState<Rental | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<Data>('/api/vehicules')
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const availableCount = useMemo(() => (data?.vehicles ?? []).filter((v) => v.status === 'available').length, [data])

  return (
    <AppShell breadcrumb="Location voiture" section="Véhicules">
      <section className="page-heading">
        <div><p className="eyebrow">LOCATION VOITURE</p><h1>Véhicules <span>et locations</span></h1><p className="heading-subtitle">Suivez la flotte, les locations en cours et les paiements.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

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
              <tr><th>Véhicule</th><th>Client</th><th>Début</th><th>Fin</th><th>Montant</th><th>Paiement</th><th></th></tr>
            </thead>
            <tbody>
              {(data?.rentals ?? []).map((rental) => (
                <tr key={rental.id}>
                  <td data-label="Véhicule">{rental.vehicleName}</td>
                  <td data-label="Client">{rental.clientName}</td>
                  <td data-label="Début">{rental.startDate}</td>
                  <td data-label="Fin">{rental.endDate ?? '—'}</td>
                  <td data-label="Montant">{rental.totalAmountFormatted}</td>
                  <td data-label="Paiement"><span className={`badge ${paymentBadge[rental.paymentStatus]}`}>{paymentLabel[rental.paymentStatus]}</span></td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {rental.paymentStatus !== 'paid' && <button className="btn-ghost" onClick={() => setPayingRental(rental)}><Wallet size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Payer</button>}
                    {rental.status === 'active' && <button className="btn-ghost" onClick={() => setClosingRental(rental)}><CheckCircle2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Clôturer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && (data?.rentals ?? []).length === 0 && <p className="table-empty">Aucune location enregistrée.</p>}
        </div>
      </div>

      <Modal open={vehicleModalOpen} onClose={() => setVehicleModalOpen(false)} title="Nouveau véhicule" subtitle="Ajoutez un véhicule à la flotte.">
        <NewVehicleForm onCreated={() => { setVehicleModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
      <Modal open={rentalVehicle !== null} onClose={() => setRentalVehicle(null)} title={`Nouvelle location — ${rentalVehicle?.name ?? ''}`} subtitle="Créez une location pour ce véhicule.">
        {rentalVehicle && <NewRentalForm vehicle={rentalVehicle} onCreated={() => { setRentalVehicle(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={closingRental !== null} onClose={() => setClosingRental(null)} title="Clôturer la location" subtitle="Enregistrez le retour du véhicule.">
        {closingRental && <CloseRentalForm rental={closingRental} onDone={() => { setClosingRental(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
      <Modal open={payingRental !== null} onClose={() => setPayingRental(null)} title="Enregistrer un paiement" subtitle="">
        {payingRental && <RentalPaymentForm rental={payingRental} onDone={() => { setPayingRental(null); setRefreshKey((key) => key + 1) }} />}
      </Modal>
    </AppShell>
  )
}
