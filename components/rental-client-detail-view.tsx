'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

const rentalStatusLabel = { active: 'Active', completed: 'Terminée', cancelled: 'Annulée' }
const rentalStatusBadge = { active: 'badge-green', completed: 'badge-muted', cancelled: 'badge-red' }
const paymentStatusLabel = { paid: 'Payé', partial: 'Partiel', unpaid: 'Non payé' }
const paymentStatusBadge = { paid: 'badge-green', partial: 'badge-orange', unpaid: 'badge-muted' }

type RentalClientDetail = {
  id: number
  name: string
  phone: string
  rentals: {
    id: number
    vehicleName: string
    startDate: string
    plannedEndDate: string
    endDate: string | null
    status: 'active' | 'completed' | 'cancelled'
    totalAmountFormatted: string
    amountPaidFormatted: string
    paymentStatus: 'paid' | 'partial' | 'unpaid'
  }[]
}

export function RentalClientDetailView({ clientId }: { clientId: number }) {
  const [client, setClient] = useState<RentalClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<{ client: RentalClientDetail }>(`/api/clients-location/${clientId}`)
      .then((json) => setClient(json.client))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [clientId])

  return (
    <AppShell breadcrumb="Location voiture" section="Dossier client">
      <Link href="/location-voiture/clients" className="text-link" style={{ marginBottom: 18, display: 'inline-flex' }}><ArrowLeft size={12} /> Retour aux clients</Link>

      {error && <LoadError message={error} onRetry={() => setLoading(true)} />}
      {loading && <p className="heading-subtitle">Chargement...</p>}

      {client && (
        <>
          <section className="page-heading">
            <div><p className="eyebrow">CLIENT</p><h1>{client.name}</h1><p className="heading-subtitle">{client.phone}</p></div>
          </section>

          <div className="panel">
            <p className="section-title">Historique des locations</p>
            <p className="section-subtitle">{client.rentals.length} location(s) au total.</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Véhicule</th>
                    <th>Début</th>
                    <th>Retour prévu</th>
                    <th>Retour réel</th>
                    <th>Montant</th>
                    <th>Paiement</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {client.rentals.map((rental) => (
                    <tr key={rental.id}>
                      <td data-label="Véhicule">{rental.vehicleName}</td>
                      <td data-label="Début">{new Date(rental.startDate).toLocaleDateString('fr-FR')}</td>
                      <td data-label="Retour prévu">{new Date(rental.plannedEndDate).toLocaleDateString('fr-FR')}</td>
                      <td data-label="Retour réel">{rental.endDate ? new Date(rental.endDate).toLocaleDateString('fr-FR') : '—'}</td>
                      <td data-label="Montant">{rental.totalAmountFormatted}</td>
                      <td data-label="Paiement">
                        <span className={`badge ${paymentStatusBadge[rental.paymentStatus]}`}>{paymentStatusLabel[rental.paymentStatus]}</span>
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>({rental.amountPaidFormatted})</span>
                      </td>
                      <td data-label="Statut"><span className={`badge ${rentalStatusBadge[rental.status]}`}>{rentalStatusLabel[rental.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {client.rentals.length === 0 && <p className="table-empty">Aucune location pour ce client.</p>}
            </div>
          </div>
        </>
      )}
    </AppShell>
  )
}
