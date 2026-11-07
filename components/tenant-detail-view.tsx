'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

const leaseStatusLabel = { active: 'Actif', ended: 'Terminé' }
const leaseStatusBadge = { active: 'badge-green', ended: 'badge-muted' }
const paymentStatusLabel = { paid: 'Payé', late: 'En retard', unpaid: 'Non payé' }
const paymentStatusBadge = { paid: 'badge-green', late: 'badge-orange', unpaid: 'badge-muted' }
const depositStatusLabel = { held: 'Détenue', returned: 'Restituée', withheld: 'Retenue' }
const depositStatusBadge = { held: 'badge-blue', returned: 'badge-green', withheld: 'badge-orange' }

type TenantDetail = {
  id: number
  name: string
  phone: string
  leases: {
    id: number
    unitLabel: string
    buildingName: string
    startDate: string
    endDate: string
    status: 'active' | 'ended'
    monthlyRentFormatted: string
    depositAmount: number
    depositAmountFormatted: string
    depositStatus: 'held' | 'returned' | 'withheld'
    depositReturnedAmountFormatted: string | null
    depositNotes: string | null
    payments: { id: number; period: string; status: 'paid' | 'late' | 'unpaid'; amountFormatted: string }[]
  }[]
}

export function TenantDetailView({ tenantId }: { tenantId: number }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<{ tenant: TenantDetail }>(`/api/locataires/${tenantId}`)
      .then((json) => setTenant(json.tenant))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [tenantId])

  return (
    <AppShell breadcrumb="Immo" section="Dossier locataire">
      <Link href="/immo/locataires" className="text-link" style={{ marginBottom: 18, display: 'inline-flex' }}><ArrowLeft size={12} /> Retour aux locataires</Link>

      {error && <LoadError message={error} onRetry={() => setLoading(true)} />}
      {loading && <p className="heading-subtitle">Chargement...</p>}

      {tenant && (
        <>
          <section className="page-heading">
            <div><p className="eyebrow">LOCATAIRE</p><h1>{tenant.name}</h1><p className="heading-subtitle">{tenant.phone}</p></div>
          </section>

          <div className="panel">
            <p className="section-title">Historique des baux</p>
            <p className="section-subtitle">{tenant.leases.length} bail(aux) au total.</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Logement</th>
                    <th>Immeuble</th>
                    <th>Début</th>
                    <th>Fin</th>
                    <th>Loyer</th>
                    <th>Caution</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.leases.map((lease) => (
                    <tr key={lease.id}>
                      <td data-label="Logement">{lease.unitLabel}</td>
                      <td data-label="Immeuble">{lease.buildingName}</td>
                      <td data-label="Début">{new Date(lease.startDate).toLocaleDateString('fr-FR')}</td>
                      <td data-label="Fin">{new Date(lease.endDate).toLocaleDateString('fr-FR')}</td>
                      <td data-label="Loyer">{lease.monthlyRentFormatted}</td>
                      <td data-label="Caution">
                        {lease.depositAmount > 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {lease.depositAmountFormatted}
                            <span className={`badge ${depositStatusBadge[lease.depositStatus]}`}>{depositStatusLabel[lease.depositStatus]}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td data-label="Statut"><span className={`badge ${leaseStatusBadge[lease.status]}`}>{leaseStatusLabel[lease.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tenant.leases.length === 0 && <p className="table-empty">Aucun bail pour ce locataire.</p>}
            </div>
          </div>

          {tenant.leases.map((lease) => (
            <div className="panel" key={lease.id} style={{ marginTop: 16 }}>
              <p className="section-title">Loyers — {lease.unitLabel} ({lease.buildingName})</p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Période</th><th>Montant</th><th>Statut</th></tr></thead>
                  <tbody>
                    {lease.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td data-label="Période">{payment.period}</td>
                        <td data-label="Montant">{payment.amountFormatted}</td>
                        <td data-label="Statut"><span className={`badge ${paymentStatusBadge[payment.status]}`}>{paymentStatusLabel[payment.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lease.payments.length === 0 && <p className="table-empty">Aucun loyer enregistré pour ce bail.</p>}
              </div>
            </div>
          ))}
        </>
      )}
    </AppShell>
  )
}
