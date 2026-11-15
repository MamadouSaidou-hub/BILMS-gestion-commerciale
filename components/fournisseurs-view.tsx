'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, Package, Pencil, Percent, Plus, Search, Trash2, Truck, Wallet, WalletCards } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { DiscountScaleModal } from '@/components/discount-scale-modal'
import { LoadError } from '@/components/load-error'
import { downloadCsv } from '@/lib/download-csv'
import { fetchJson } from '@/lib/fetch-json'
import { businessConfig } from '@/lib/business-config'

type Supplier = {
  id: number
  name: string
  phone: string
  owed: string
  totalPaid: string
  sacksThisMonth: number
  status: 'ok' | 'pending' | 'overdue'
}

type SuppliersData = {
  suppliers: Supplier[]
  summary: { totalSuppliers: number; totalOwed: string; deliveriesThisMonth: number }
}

type StoreOption = { id: number; name: string }
type ProductOption = { id: number; name: string; sku: string }

const statusLabel = { ok: 'À jour', pending: 'En cours', overdue: 'En retard' }
const statusBadge = { ok: 'badge-green', pending: 'badge-blue', overdue: 'badge-red' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Truck; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewSupplierForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/fournisseurs', {
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
      <div className="form-field"><label>Nom du fournisseur</label><input required value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="form-field"><label>Téléphone</label><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="6XX XX XX XX" /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer le fournisseur'}</button></div>
    </form>
  )
}

function RecordDeliveryForm({
  supplier,
  storeOptions,
  productOptions,
  onCreated,
}: {
  supplier: Supplier
  storeOptions: StoreOption[]
  productOptions: ProductOption[]
  onCreated: () => void
}) {
  const [storeId, setStoreId] = useState('')
  const [productId, setProductId] = useState('')
  const [sackCount, setSackCount] = useState('')
  const [tonnage, setTonnage] = useState('')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partial' | 'credit'>('credit')
  const [paidNow, setPaidNow] = useState('')
  const [dueInDays, setDueInDays] = useState('30')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/fournisseurs/${supplier.id}/livraisons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          productId,
          sackCount,
          tonnage: tonnage || null,
          reference: reference || undefined,
          date: date || undefined,
          paymentStatus,
          paidNow: paymentStatus === 'partial' ? paidNow : 0,
          dueInDays,
        }),
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
        <div className="form-field">
          <label>Magasin de réception</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Produit</label>
          <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Sélectionner...</option>
            {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Nombre de {businessConfig.unit.basePluralLower}</label><input required type="number" min="1" value={sackCount} onChange={(event) => setSackCount(event.target.value)} /></div>
        <div className="form-field"><label>Poids/volume (optionnel)</label><input type="number" min="0" step="0.01" value={tonnage} onChange={(event) => setTonnage(event.target.value)} placeholder="Pour info uniquement" /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date de livraison</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="form-field"><label>Référence bon de livraison (optionnel)</label><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ex : plaque du camion" /></div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label>Statut de paiement</label>
          <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as typeof paymentStatus)}>
            <option value="credit">À crédit</option>
            <option value="partial">Paiement partiel</option>
            <option value="paid">Payée comptant</option>
          </select>
        </div>
        {paymentStatus === 'partial' && (
          <div className="form-field"><label>Montant payé maintenant</label><input required type="number" min="0" value={paidNow} onChange={(event) => setPaidNow(event.target.value)} /></div>
        )}
        {paymentStatus !== 'paid' && (
          <div className="form-field"><label>Échéance (jours)</label><input required type="number" min="1" value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} /></div>
        )}
      </div>

      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer la livraison'}</button></div>
    </form>
  )
}

function RecordSupplierPaymentForm({ supplier, onCreated }: { supplier: Supplier; onCreated: () => void }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'mobile_money' | 'bank_transfer' | 'check'>('bank_transfer')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/fournisseurs/${supplier.id}/paiements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method }),
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
      <p className="section-subtitle">Dû au fournisseur : <strong>{supplier.owed}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Montant payé (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="form-field">
          <label>Méthode</label>
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="bank_transfer">Virement</option>
            <option value="check">Chèque</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="cash">Espèces</option>
          </select>
        </div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer le paiement'}</button></div>
    </form>
  )
}

type DeliveryRow = {
  id: number
  storeId: number
  storeName: string
  productId: number
  productName: string
  reference: string | null
  sackCount: number
  tonnage: number | null
  totalAmount: number
  totalAmountFormatted: string
  date: string | null
  effectiveDate: string
  createdAt: string
}

type SupplierPaymentRow = {
  id: number
  amount: number
  amountFormatted: string
  method: 'cash' | 'mobile_money' | 'bank_transfer' | 'check'
  createdAt: string
}

function EditDeliveryForm({
  supplierId,
  delivery,
  storeOptions,
  productOptions,
  onSaved,
}: {
  supplierId: number
  delivery: DeliveryRow
  storeOptions: StoreOption[]
  productOptions: ProductOption[]
  onSaved: () => void
}) {
  const [storeId, setStoreId] = useState(String(delivery.storeId))
  const [productId, setProductId] = useState(String(delivery.productId))
  const [sackCount, setSackCount] = useState(String(delivery.sackCount))
  const [tonnage, setTonnage] = useState(delivery.tonnage !== null ? String(delivery.tonnage) : '')
  const [reference, setReference] = useState(delivery.reference ?? '')
  const [date, setDate] = useState((delivery.date ?? '').slice(0, 10))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/fournisseurs/${supplierId}/livraisons/${delivery.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          productId,
          sackCount,
          tonnage: tonnage || null,
          reference: reference || null,
          date: date || null,
          paymentStatus: 'paid', // Payment terms aren't corrected here — only quantity/product/store/date.
          paidNow: 0,
          dueInDays: 30,
          reason: reason || undefined,
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
      <p className="section-subtitle">Montant actuel : <strong>{delivery.totalAmountFormatted}</strong></p>
      <div className="form-row">
        <div className="form-field">
          <label>Magasin de réception</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Produit</label>
          <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
            {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Nombre de {businessConfig.unit.basePluralLower}</label><input required type="number" min="1" value={sackCount} onChange={(event) => setSackCount(event.target.value)} /></div>
        <div className="form-field"><label>Poids/volume (optionnel)</label><input type="number" min="0" step="0.01" value={tonnage} onChange={(event) => setTonnage(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Date de livraison</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="form-field"><label>Référence bon de livraison (optionnel)</label><input value={reference} onChange={(event) => setReference(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <p className="section-subtitle" style={{ fontSize: 11 }}>Le statut de paiement n’est pas modifié ici — si cette livraison a déjà une dette en cours, elle est recréée au même montant recalculé.</p>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeleteDeliveryConfirm({ supplierId, delivery, onClose, onDone }: { supplierId: number; delivery: DeliveryRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/fournisseurs/${supplierId}/livraisons/${delivery.id}`, {
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
        Le stock reçu sera retiré. Si une dette est en cours sur cette livraison, elle est supprimée. La livraison reste
        visible en base (avec qui et quand) à des fins d’audit, mais disparaît de la liste et des totaux.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder la livraison</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer la livraison'}</button>
      </div>
    </div>
  )
}

function EditSupplierPaymentForm({ supplierId, payment, onSaved }: { supplierId: number; payment: SupplierPaymentRow; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(payment.amount))
  const [method, setMethod] = useState(payment.method)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/fournisseurs/${supplierId}/paiements/${payment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method, reason: reason || undefined }),
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
        <div className="form-field"><label>Montant (GNF)</label><input required type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="form-field">
          <label>Méthode</label>
          <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="bank_transfer">Virement</option>
            <option value="check">Chèque</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="cash">Espèces</option>
          </select>
        </div>
      </div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeleteSupplierPaymentConfirm({ supplierId, payment, onClose, onDone }: { supplierId: number; payment: SupplierPaymentRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/fournisseurs/${supplierId}/paiements/${payment.id}`, {
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
        La dette que ce paiement avait réglée sera rouverte pour le montant correspondant. Le paiement reste visible en
        base (avec qui et quand) à des fins d’audit, mais disparaît de la liste et des totaux.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder le paiement</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer le paiement'}</button>
      </div>
    </div>
  )
}

function SupplierHistory({
  supplier,
  storeOptions,
  productOptions,
}: {
  supplier: Supplier
  storeOptions: StoreOption[]
  productOptions: ProductOption[]
}) {
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([])
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editingDelivery, setEditingDelivery] = useState<DeliveryRow | null>(null)
  const [deletingDelivery, setDeletingDelivery] = useState<DeliveryRow | null>(null)
  const [editingPayment, setEditingPayment] = useState<SupplierPaymentRow | null>(null)
  const [deletingPayment, setDeletingPayment] = useState<SupplierPaymentRow | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchJson<{ deliveries: DeliveryRow[] }>(`/api/fournisseurs/${supplier.id}/livraisons`),
      fetchJson<{ payments: SupplierPaymentRow[] }>(`/api/fournisseurs/${supplier.id}/paiements`),
    ])
      .then(([deliveriesJson, paymentsJson]) => {
        setDeliveries(deliveriesJson.deliveries)
        setPayments(paymentsJson.payments)
      })
      .finally(() => setLoading(false))
  }, [supplier.id, refreshKey])

  function refresh() {
    setRefreshKey((key) => key + 1)
  }

  return (
    <div>
      <p className="section-title">Livraisons</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Produit</th><th>Magasin</th><th>{businessConfig.unit.basePlural}</th><th>Montant</th><th></th></tr></thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td data-label="Date">{new Date(delivery.effectiveDate).toLocaleDateString('fr-FR')}</td>
                <td data-label="Produit">{delivery.productName}</td>
                <td data-label="Magasin">{delivery.storeName}</td>
                <td data-label={businessConfig.unit.basePlural}>{delivery.sackCount}</td>
                <td data-label="Montant">{delivery.totalAmountFormatted}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn-ghost" onClick={() => setEditingDelivery(delivery)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                  <button className="btn-ghost" onClick={() => setDeletingDelivery(delivery)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && deliveries.length === 0 && <p className="table-empty">Aucune livraison enregistrée.</p>}
      </div>

      <p className="section-title" style={{ marginTop: 20 }}>Paiements</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Date</th><th>Méthode</th><th>Montant</th><th></th></tr></thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id}>
                <td data-label="Date">{new Date(payment.createdAt).toLocaleDateString('fr-FR')}</td>
                <td data-label="Méthode">{payment.method}</td>
                <td data-label="Montant">{payment.amountFormatted}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn-ghost" onClick={() => setEditingPayment(payment)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                  <button className="btn-ghost" onClick={() => setDeletingPayment(payment)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && payments.length === 0 && <p className="table-empty">Aucun paiement enregistré.</p>}
      </div>

      <Modal open={editingDelivery !== null} onClose={() => setEditingDelivery(null)} title="Modifier la livraison" subtitle="">
        {editingDelivery && (
          <EditDeliveryForm supplierId={supplier.id} delivery={editingDelivery} storeOptions={storeOptions} productOptions={productOptions} onSaved={() => { setEditingDelivery(null); refresh() }} />
        )}
      </Modal>
      <Modal open={deletingDelivery !== null} onClose={() => setDeletingDelivery(null)} title="Supprimer cette livraison ?" subtitle="">
        {deletingDelivery && <DeleteDeliveryConfirm supplierId={supplier.id} delivery={deletingDelivery} onClose={() => setDeletingDelivery(null)} onDone={() => { setDeletingDelivery(null); refresh() }} />}
      </Modal>
      <Modal open={editingPayment !== null} onClose={() => setEditingPayment(null)} title="Modifier le paiement" subtitle="">
        {editingPayment && <EditSupplierPaymentForm supplierId={supplier.id} payment={editingPayment} onSaved={() => { setEditingPayment(null); refresh() }} />}
      </Modal>
      <Modal open={deletingPayment !== null} onClose={() => setDeletingPayment(null)} title="Supprimer ce paiement ?" subtitle="">
        {deletingPayment && <DeleteSupplierPaymentConfirm supplierId={supplier.id} payment={deletingPayment} onClose={() => setDeletingPayment(null)} onDone={() => { setDeletingPayment(null); refresh() }} />}
      </Modal>
    </div>
  )
}

export function FournisseursView() {
  const [search, setSearch] = useState('')
  const [data, setData] = useState<SuppliersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [deliverySupplier, setDeliverySupplier] = useState<Supplier | null>(null)
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null)
  const [discountSupplier, setDiscountSupplier] = useState<Supplier | null>(null)
  const [historySupplier, setHistorySupplier] = useState<Supplier | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fetchJson<SuppliersData>('/api/fournisseurs')
      .then((json) => setData(json))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
      .finally(() => setLoading(false))
    fetchJson<{ stores: StoreOption[] }>('/api/magasins').then((json) => setStoreOptions(json.stores)).catch(() => {})
    fetchJson<{ products: ProductOption[] }>('/api/products').then((json) => setProductOptions(json.products)).catch(() => {})
  }, [refreshKey])

  const filteredSuppliers = useMemo(() => {
    const rows = data?.suppliers ?? []
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(query) || row.phone.toLowerCase().includes(query))
  }, [data, search])

  return (
    <AppShell breadcrumb="Gestion" section="Fournisseurs" onExport={() => downloadCsv('/api/fournisseurs?format=csv', 'fournisseurs.csv')}>
      <section className="page-heading">
        <div><p className="eyebrow">APPROVISIONNEMENT</p><h1>Fournisseurs <span>et livraisons</span></h1><p className="heading-subtitle">Suivez les livraisons reçues et les sommes dues à vos fournisseurs.</p></div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs fournisseurs" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <MetricCard label="Fournisseurs" value={data ? `${data.summary.totalSuppliers}` : '—'} icon={Truck} tone="navy" />
        <MetricCard label="Dû aux fournisseurs" value={data ? data.summary.totalOwed : '—'} icon={Wallet} tone="orange" />
        <MetricCard label="Livraisons ce mois" value={data ? `${data.summary.deliveriesThisMonth}` : '—'} icon={Package} tone="blue" />
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <input placeholder="Rechercher un fournisseur..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher un fournisseur" />
        </div>
        <button className="btn-primary" onClick={() => setSupplierModalOpen(true)}><Plus size={14} /> Nouveau fournisseur</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fournisseur</th>
                <th>Téléphone</th>
                <th>{businessConfig.unit.basePlural} ce mois</th>
                <th>Payé au total</th>
                <th>Dû</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td data-label="Fournisseur"><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Truck size={13} color="var(--faint)" />{supplier.name}</span></td>
                  <td data-label="Téléphone">{supplier.phone}</td>
                  <td data-label={`${businessConfig.unit.basePlural} ce mois`}>{supplier.sacksThisMonth}</td>
                  <td data-label="Payé">{supplier.totalPaid}</td>
                  <td data-label="Dû">{supplier.owed}</td>
                  <td data-label="Statut"><span className={`badge ${statusBadge[supplier.status]}`}>{statusLabel[supplier.status]}</span></td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn-ghost" onClick={() => setDeliverySupplier(supplier)}><Package size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Livraison</button>
                    {supplier.status !== 'ok' && (
                      <button className="btn-ghost" onClick={() => setPaymentSupplier(supplier)}><WalletCards size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Payer</button>
                    )}
                    <button className="btn-ghost" onClick={() => setDiscountSupplier(supplier)}><Percent size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Barème</button>
                    <button className="btn-ghost" onClick={() => setHistorySupplier(supplier)}><History size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Historique</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredSuppliers.length === 0 && <p className="table-empty">Aucun fournisseur trouvé.</p>}
        </div>
      </div>

      <Modal open={supplierModalOpen} onClose={() => setSupplierModalOpen(false)} title="Nouveau fournisseur" subtitle="Ajoutez un fournisseur.">
        <NewSupplierForm onCreated={() => { setSupplierModalOpen(false); setRefreshKey((key) => key + 1) }} />
      </Modal>
      <Modal open={deliverySupplier !== null} onClose={() => setDeliverySupplier(null)} title={`Nouvelle livraison — ${deliverySupplier?.name ?? ''}`} subtitle={`Enregistrez une réception de ${businessConfig.unit.basePluralLower} et mettez à jour le stock.`} wide>
        {deliverySupplier && (
          <RecordDeliveryForm
            supplier={deliverySupplier}
            storeOptions={storeOptions}
            productOptions={productOptions}
            onCreated={() => { setDeliverySupplier(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
      <Modal open={paymentSupplier !== null} onClose={() => setPaymentSupplier(null)} title={`Payer — ${paymentSupplier?.name ?? ''}`} subtitle="Enregistrez un paiement effectué à ce fournisseur.">
        {paymentSupplier && (
          <RecordSupplierPaymentForm
            supplier={paymentSupplier}
            onCreated={() => { setPaymentSupplier(null); setRefreshKey((key) => key + 1) }}
          />
        )}
      </Modal>
      {discountSupplier && (
        <DiscountScaleModal
          open={discountSupplier !== null}
          onClose={() => setDiscountSupplier(null)}
          partyType="supplier"
          partyId={discountSupplier.id}
          partyName={discountSupplier.name}
        />
      )}
      <Modal open={historySupplier !== null} onClose={() => setHistorySupplier(null)} title={`Historique — ${historySupplier?.name ?? ''}`} wide>
        {historySupplier && <SupplierHistory supplier={historySupplier} storeOptions={storeOptions} productOptions={productOptions} />}
      </Modal>
    </AppShell>
  )
}
