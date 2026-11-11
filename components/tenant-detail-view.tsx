'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileText, Pencil } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { fetchJson } from '@/lib/fetch-json'

const leaseStatusLabel = { active: 'Actif', ended: 'Terminé' }
const leaseStatusBadge = { active: 'badge-green', ended: 'badge-muted' }
const paymentStatusLabel = { paid: 'Payé', late: 'En retard', unpaid: 'Non payé' }
const paymentStatusBadge = { paid: 'badge-green', late: 'badge-orange', unpaid: 'badge-muted' }
const depositStatusLabel = { held: 'Détenue', returned: 'Restituée', withheld: 'Retenue' }
const depositStatusBadge = { held: 'badge-blue', returned: 'badge-green', withheld: 'badge-orange' }

type Lease = {
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
  durationMonths: number
  noticeMonths: number
  latePenaltyPct: number
  guarantorName: string | null
  guarantorPhone: string | null
  guarantorEmail: string | null
  guarantorResidence: string | null
  guarantorNationality: string | null
  guarantorCin: string | null
  guarantorCinValidUntil: string | null
  payments: { id: number; period: string; status: 'paid' | 'late' | 'unpaid'; amountFormatted: string }[]
}

type TenantDetail = {
  id: number
  name: string
  phone: string
  email: string | null
  profession: string | null
  birthDate: string | null
  birthPlace: string | null
  nationality: string | null
  cin: string | null
  cinValidUntil: string | null
  leases: Lease[]
}

function EditTenantBioForm({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const [phone, setPhone] = useState(tenant.phone === '—' ? '' : tenant.phone)
  const [email, setEmail] = useState(tenant.email ?? '')
  const [profession, setProfession] = useState(tenant.profession ?? '')
  const [birthDate, setBirthDate] = useState(tenant.birthDate ?? '')
  const [birthPlace, setBirthPlace] = useState(tenant.birthPlace ?? '')
  const [nationality, setNationality] = useState(tenant.nationality ?? '')
  const [cin, setCin] = useState(tenant.cin ?? '')
  const [cinValidUntil, setCinValidUntil] = useState(tenant.cinValidUntil ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/locataires/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, email, profession, birthDate, birthPlace, nationality, cin, cinValidUntil }),
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
      <p className="section-subtitle">Ces informations servent à remplir automatiquement le contrat de bail.</p>
      <div className="form-row">
        <div className="form-field"><label>Téléphone</label><input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
        <div className="form-field"><label>Email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Profession</label><input value={profession} onChange={(event) => setProfession(event.target.value)} placeholder="Ex : Gestionnaire" /></div>
        <div className="form-field"><label>Nationalité</label><input value={nationality} onChange={(event) => setNationality(event.target.value)} placeholder="Guinéenne" /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date de naissance</label><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></div>
        <div className="form-field"><label>Lieu de naissance</label><input value={birthPlace} onChange={(event) => setBirthPlace(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>N° CIN</label><input value={cin} onChange={(event) => setCin(event.target.value)} /></div>
        <div className="form-field"><label>CIN valable jusqu’au</label><input type="date" value={cinValidUntil} onChange={(event) => setCinValidUntil(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button></div>
    </form>
  )
}

function EditLeaseTermsForm({ lease, onSaved }: { lease: Lease; onSaved: () => void }) {
  const [noticeMonths, setNoticeMonths] = useState(String(lease.noticeMonths))
  const [latePenaltyPct, setLatePenaltyPct] = useState(String(lease.latePenaltyPct))
  const [guarantorName, setGuarantorName] = useState(lease.guarantorName ?? '')
  const [guarantorPhone, setGuarantorPhone] = useState(lease.guarantorPhone ?? '')
  const [guarantorEmail, setGuarantorEmail] = useState(lease.guarantorEmail ?? '')
  const [guarantorResidence, setGuarantorResidence] = useState(lease.guarantorResidence ?? '')
  const [guarantorNationality, setGuarantorNationality] = useState(lease.guarantorNationality ?? '')
  const [guarantorCin, setGuarantorCin] = useState(lease.guarantorCin ?? '')
  const [guarantorCinValidUntil, setGuarantorCinValidUntil] = useState(lease.guarantorCinValidUntil ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/baux/${lease.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noticeMonths,
          latePenaltyPct,
          guarantorName,
          guarantorPhone,
          guarantorEmail,
          guarantorResidence,
          guarantorNationality,
          guarantorCin,
          guarantorCinValidUntil,
        }),
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
      <div className="form-row">
        <div className="form-field"><label>Préavis (mois)</label><input required type="number" min="1" value={noticeMonths} onChange={(event) => setNoticeMonths(event.target.value)} /></div>
        <div className="form-field"><label>Pénalité de retard (%)</label><input required type="number" min="0" value={latePenaltyPct} onChange={(event) => setLatePenaltyPct(event.target.value)} /></div>
      </div>
      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', display: 'block', margin: '10px 0 6px' }}>Garant (caution solidaire) — laisser vide si aucun</label>
      <div className="form-row">
        <div className="form-field"><label>Nom</label><input value={guarantorName} onChange={(event) => setGuarantorName(event.target.value)} /></div>
        <div className="form-field"><label>Téléphone</label><input value={guarantorPhone} onChange={(event) => setGuarantorPhone(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Email</label><input type="email" value={guarantorEmail} onChange={(event) => setGuarantorEmail(event.target.value)} /></div>
        <div className="form-field"><label>Résidence</label><input value={guarantorResidence} onChange={(event) => setGuarantorResidence(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Nationalité</label><input value={guarantorNationality} onChange={(event) => setGuarantorNationality(event.target.value)} placeholder="Guinéenne" /></div>
        <div className="form-field"><label>N° CIN</label><input value={guarantorCin} onChange={(event) => setGuarantorCin(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>CIN valable jusqu’au</label><input type="date" value={guarantorCinValidUntil} onChange={(event) => setGuarantorCinValidUntil(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer'}</button></div>
    </form>
  )
}

export function TenantDetailView({ tenantId }: { tenantId: number }) {
  const [tenant, setTenant] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingBio, setEditingBio] = useState(false)
  const [editingLease, setEditingLease] = useState<Lease | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<{ tenant: TenantDetail }>(`/api/locataires/${tenantId}`)
      .then((json) => setTenant(json.tenant))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [tenantId, refreshKey])

  return (
    <AppShell breadcrumb="Immo" section="Dossier locataire">
      <Link href="/immo/locataires" className="text-link" style={{ marginBottom: 18, display: 'inline-flex' }}><ArrowLeft size={12} /> Retour aux locataires</Link>

      {error && <LoadError message={error} onRetry={() => setLoading(true)} />}
      {loading && <p className="heading-subtitle">Chargement...</p>}

      {tenant && (
        <>
          <section className="page-heading">
            <div><p className="eyebrow">LOCATAIRE</p><h1>{tenant.name}</h1><p className="heading-subtitle">{tenant.phone}{tenant.cin ? ` · CIN ${tenant.cin}` : ''}</p></div>
            <button className="btn-secondary" onClick={() => setEditingBio(true)}><Pencil size={13} /> Modifier les informations</button>
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
                    <th></th>
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
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Link className="btn-ghost" href={`/immo/baux/${lease.id}/contrat`} target="_blank" rel="noopener noreferrer"><FileText size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Contrat</Link>
                        <button type="button" className="btn-ghost" onClick={() => setEditingLease(lease)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Garant</button>
                      </td>
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

          <Modal open={editingBio} onClose={() => setEditingBio(false)} title="Modifier les informations du locataire" subtitle={tenant.name}>
            <EditTenantBioForm tenant={tenant} onSaved={() => { setEditingBio(false); setRefreshKey((key) => key + 1) }} />
          </Modal>

          <Modal open={editingLease !== null} onClose={() => setEditingLease(null)} title="Garant & conditions du bail" subtitle={editingLease ? `${editingLease.unitLabel} — ${editingLease.buildingName}` : ''}>
            {editingLease && <EditLeaseTermsForm lease={editingLease} onSaved={() => { setEditingLease(null); setRefreshKey((key) => key + 1) }} />}
          </Modal>
        </>
      )}
    </AppShell>
  )
}
