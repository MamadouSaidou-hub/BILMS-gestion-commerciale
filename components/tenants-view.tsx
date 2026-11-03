'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Plus, Search, Users } from 'lucide-react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { downloadCsv } from '@/lib/download-csv'
import { fetchJson } from '@/lib/fetch-json'

type Tenant = {
  id: number
  name: string
  phone: string
  leasesCount: number
  hasActiveLease: boolean
  totalPaidFormatted: string
}

type TenantsData = {
  tenants: Tenant[]
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Users; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewTenantForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/locataires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
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
      <div className="form-field"><label>Nom du locataire</label><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Mamadou Diallo" /></div>
      <div className="form-field"><label>Téléphone</label><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XX XX XX XX" /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer le locataire'}</button></div>
    </form>
  )
}

export function TenantsView() {
  const [search, setSearch] = useState('')
  const [data, setData] = useState<TenantsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<TenantsData>('/api/locataires')
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const filteredTenants = useMemo(() => {
    const rows = data?.tenants ?? []
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(query) || row.phone.toLowerCase().includes(query))
  }, [data, search])

  return (
    <AppShell breadcrumb="Immo" section="Locataires" onExport={() => downloadCsv('/api/locataires?format=csv', 'locataires.csv')}>
      <section className="page-heading">
        <div><p className="eyebrow">IMMO</p><h1>Locataires <span>et historique</span></h1><p className="heading-subtitle">Un dossier par locataire, avec tous ses baux passés et en cours.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs locataires" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <MetricCard label="Locataires suivis" value={data ? `${data.tenants.length}` : '—'} icon={Users} tone="navy" />
        <MetricCard label="Baux actifs" value={data ? `${data.tenants.filter((t) => t.hasActiveLease).length}` : '—'} icon={FileText} tone="green" />
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <input placeholder="Rechercher un locataire, un téléphone..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher un locataire" />
        </div>
        <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} /> Nouveau locataire</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Locataire</th>
                <th>Téléphone</th>
                <th>Baux</th>
                <th>Statut</th>
                <th>Encaissé au total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td data-label="Locataire">{tenant.name}</td>
                  <td data-label="Téléphone">{tenant.phone}</td>
                  <td data-label="Baux">{tenant.leasesCount}</td>
                  <td data-label="Statut"><span className={`badge ${tenant.hasActiveLease ? 'badge-green' : 'badge-muted'}`}>{tenant.hasActiveLease ? 'Bail actif' : 'Aucun bail actif'}</span></td>
                  <td data-label="Encaissé">{tenant.totalPaidFormatted}</td>
                  <td><Link className="btn-ghost" href={`/immo/locataires/${tenant.id}`}>Dossier</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredTenants.length === 0 && <p className="table-empty">Aucun locataire trouvé.</p>}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau locataire" subtitle="Ajoutez un locataire à votre répertoire.">
        <NewTenantForm onCreated={() => { setModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
    </AppShell>
  )
}
