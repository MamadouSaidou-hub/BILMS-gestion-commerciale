'use client'

import { useEffect, useMemo, useState } from 'react'
import { Car, Plus, Search, Users } from 'lucide-react'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { downloadCsv } from '@/lib/download-csv'
import { fetchJson } from '@/lib/fetch-json'

type RentalClient = {
  id: number
  name: string
  phone: string
  rentalsCount: number
  hasActiveRental: boolean
  totalPaidFormatted: string
}

type RentalClientsData = {
  clients: RentalClient[]
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

function NewRentalClientForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/clients-location', {
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
      <div className="form-field"><label>Nom du client</label><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Mamadou Diallo" /></div>
      <div className="form-field"><label>Téléphone</label><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XX XX XX XX" /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer le client'}</button></div>
    </form>
  )
}

export function RentalClientsView() {
  const [search, setSearch] = useState('')
  const [data, setData] = useState<RentalClientsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<RentalClientsData>('/api/clients-location')
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const filteredClients = useMemo(() => {
    const rows = data?.clients ?? []
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(query) || row.phone.toLowerCase().includes(query))
  }, [data, search])

  return (
    <AppShell breadcrumb="Location voiture" section="Clients" onExport={() => downloadCsv('/api/clients-location?format=csv', 'clients-location.csv')}>
      <section className="page-heading">
        <div><p className="eyebrow">LOCATION VOITURE</p><h1>Clients <span>et historique</span></h1><p className="heading-subtitle">Un dossier par client, avec toutes ses locations passées et en cours.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs clients" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <MetricCard label="Clients suivis" value={data ? `${data.clients.length}` : '—'} icon={Users} tone="navy" />
        <MetricCard label="Locations actives" value={data ? `${data.clients.filter((c) => c.hasActiveRental).length}` : '—'} icon={Car} tone="green" />
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <input placeholder="Rechercher un client, un téléphone..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher un client" />
        </div>
        <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} /> Nouveau client</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Téléphone</th>
                <th>Locations</th>
                <th>Statut</th>
                <th>Encaissé au total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <tr key={client.id}>
                  <td data-label="Client">{client.name}</td>
                  <td data-label="Téléphone">{client.phone}</td>
                  <td data-label="Locations">{client.rentalsCount}</td>
                  <td data-label="Statut"><span className={`badge ${client.hasActiveRental ? 'badge-green' : 'badge-muted'}`}>{client.hasActiveRental ? 'Location active' : 'Aucune location active'}</span></td>
                  <td data-label="Encaissé">{client.totalPaidFormatted}</td>
                  <td><Link className="btn-ghost" href={`/location-voiture/clients/${client.id}`}>Dossier</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredClients.length === 0 && <p className="table-empty">Aucun client trouvé.</p>}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouveau client" subtitle="Ajoutez un client à votre répertoire.">
        <NewRentalClientForm onCreated={() => { setModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
    </AppShell>
  )
}
