'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ClipboardCheck, Layers, Package, PackagePlus, Pencil, Plus, Search, Trash2, Upload, Wallet } from 'lucide-react'
import { SkeletonCards, SkeletonRows } from '@/components/skeleton'
import { AppShell } from '@/components/app-shell'
import { downloadCsv } from '@/lib/download-csv'
import { fetchJson } from '@/lib/fetch-json'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { authClient } from '@/lib/auth-client'

type StockItem = {
  name: string
  sku: string
  category: string
  store: string
  quantity: number
  threshold: number
  unitPrice: string
  status: 'critical' | 'low' | 'ok'
}

type StockData = {
  items: StockItem[]
  summary: { totalArticles: number; totalQuantity: number; lowCount: number; stockValue: string }
  stores: string[]
}

type StoreOption = { id: number; name: string }
type ProductOption = { id: number; name: string; sku: string }
type StockCountRow = {
  id: number
  productId: number
  productName: string
  sku: string
  storeId: number
  storeName: string
  theoreticalQty: number
  countedQty: number
  variance: number
  ownDate: string | null
  createdAt: string
}

type StockReceptionItem = { productId: number; productName: string; sku: string; quantity: number }

type StockReceptionRow = {
  id: number
  storeId: number
  storeName: string
  reference: string | null
  date: string
  createdAt: string
  items: StockReceptionItem[]
}

const statusLabel = { ok: 'OK', low: 'Faible', critical: 'Critique' }
const statusBadge = { ok: 'badge-green', low: 'badge-orange', critical: 'badge-red' }

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof Package; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewProductForm({ storeOptions, onCreated }: { storeOptions: StoreOption[]; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [category, setCategory] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [reorderThreshold, setReorderThreshold] = useState('10')
  const [storeId, setStoreId] = useState('')
  const [initialQuantity, setInitialQuantity] = useState('0')
  const [unit, setUnit] = useState<'sack' | 'carton'>('sack')
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
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sku, category, unitPrice, costPrice, reorderThreshold, storeId, initialQuantity, unit }),
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
      <div className="form-field"><label>Nom de l’article</label><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex : Riz parfumé 25kg" /></div>
      <div className="form-row">
        <div className="form-field"><label>SKU</label><input required value={sku} onChange={(event) => setSku(event.target.value)} placeholder="RIZ-25" /></div>
        <div className="form-field"><label>Catégorie</label><input required value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Épicerie" /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Prix de vente (GNF)</label><input required type="number" min="0" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></div>
        <div className="form-field"><label>Prix d’achat (GNF)</label><input required type="number" min="0" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="form-field"><label>Seuil d’alerte</label><input required type="number" min="0" value={reorderThreshold} onChange={(event) => setReorderThreshold(event.target.value)} /></div>
        <div className="form-field"><label>Quantité initiale</label><input required type="number" min="0" value={initialQuantity} onChange={(event) => setInitialQuantity(event.target.value)} /></div>
      </div>
      <div className="form-field">
        <label>Unité de vente</label>
        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <input type="radio" name="product-unit" checked={unit === 'sack'} onChange={() => setUnit('sack')} /> Sac
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
            <input type="radio" name="product-unit" checked={unit === 'carton'} onChange={() => setUnit('carton')} /> Carton
          </label>
        </div>
      </div>
      <div className="form-field">
        <label>Magasin de départ</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Création...' : 'Créer l’article'}</button></div>
    </form>
  )
}

function ImportProductsForm({ storeOptions, onImported }: { storeOptions: StoreOption[]; onImported: () => void }) {
  const [storeId, setStoreId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: { row: number; reason: string }[] } | null>(null)

  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Choisissez un fichier .csv ou .xlsx.')
      return
    }
    setError('')
    setResult(null)
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('storeId', storeId)
      const res = await fetch('/api/products/import', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      setResult(json)
      onImported()
    } catch {
      setError('Connexion instable — impossible de contacter le serveur. Réessayez.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <p className="section-subtitle">
        Fichier .csv ou .xlsx avec les colonnes : <strong>Code-barres</strong> (optionnel), <strong>Nom</strong>, <strong>Catégorie</strong>,{' '}
        <strong>Prix d’achat</strong>, <strong>Prix de vente</strong>, <strong>Stock initial</strong> (optionnel), <strong>Seuil d’alerte</strong> (optionnel),{' '}
        <strong>Pièces par carton</strong> (optionnel).
      </p>
      <div className="form-field">
        <label>Magasin cible (pour le stock initial)</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label>Fichier</label>
        <input required type="file" accept=".csv,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Import...' : 'Importer'}</button></div>

      {result && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border, #e3e9f1)' }}>
          <p style={{ fontWeight: 700, color: 'var(--green, #2e9e3f)' }}>{result.imported} produit(s) importé(s).</p>
          {result.skipped.length > 0 && (
            <>
              <p style={{ fontWeight: 700, color: 'var(--red, #d1453d)', marginTop: 8 }}>{result.skipped.length} ligne(s) ignorée(s) :</p>
              <ul style={{ fontSize: 12, color: 'var(--muted)', paddingLeft: 18 }}>
                {result.skipped.map((s, index) => <li key={index}>Ligne {s.row} : {s.reason}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </form>
  )
}

type ReceptionItemRow = { productId: string; quantity: string }

function ReceptionItemRows({
  items,
  productOptions,
  onChange,
}: {
  items: ReceptionItemRow[]
  productOptions: ProductOption[]
  onChange: (items: ReceptionItemRow[]) => void
}) {
  function update(index: number, patch: Partial<ReceptionItemRow>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }
  function add() {
    onChange([...items, { productId: '', quantity: '' }])
  }
  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Articles reçus</label>
      {items.map((item, index) => (
        <div key={index} className="item-row-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto' }}>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <select required value={item.productId} onChange={(event) => update(index, { productId: event.target.value })}>
              <option value="">Sélectionner...</option>
              {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.sku})</option>)}
            </select>
          </div>
          <div className="form-field" style={{ marginBottom: 0 }}>
            <input required type="number" min="1" placeholder="Quantité" value={item.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
          </div>
          <button type="button" className="item-row-remove" onClick={() => remove(index)} disabled={items.length === 1} aria-label="Retirer l’article"><Trash2 size={14} /></button>
        </div>
      ))}
      <button type="button" className="item-add-link" onClick={add}><Plus size={13} /> Ajouter un article</button>
    </div>
  )
}

function StockReceptionForm({ storeOptions, productOptions, onCreated }: { storeOptions: StoreOption[]; productOptions: ProductOption[]; onCreated: () => void }) {
  const [storeId, setStoreId] = useState('')
  const [items, setItems] = useState<ReceptionItemRow[]>([{ productId: '', quantity: '' }])
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!items[0].productId && productOptions.length > 0) setItems([{ ...items[0], productId: String(productOptions[0].id) }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productOptions])
  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, items, reference, date: date || undefined }),
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
        <label>Magasin</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>

      <ReceptionItemRows items={items} productOptions={productOptions} onChange={setItems} />

      <div className="form-row">
        <div className="form-field">
          <label>Date de réception</label>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="form-field"><label>Référence (optionnel)</label><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="BL fournisseur..." /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer la réception'}</button></div>
    </form>
  )
}

function StockCountForm({
  storeOptions,
  productOptions,
  stockItems,
  onCreated,
}: {
  storeOptions: StoreOption[]
  productOptions: ProductOption[]
  stockItems: StockItem[]
  onCreated: () => void
}) {
  const [productId, setProductId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [countedQty, setCountedQty] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!productId && productOptions.length > 0) setProductId(String(productOptions[0].id))
  }, [productOptions, productId])
  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  const selectedProduct = productOptions.find((option) => String(option.id) === productId)
  const selectedStore = storeOptions.find((option) => String(option.id) === storeId)
  const theoreticalItem = stockItems.find((item) => item.sku === selectedProduct?.sku && item.store === selectedStore?.name)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/stock/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, storeId, countedQty, date: date || undefined }),
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
        <label>Article</label>
        <select required value={productId} onChange={(event) => setProductId(event.target.value)}>
          {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.sku})</option>)}
        </select>
      </div>
      <div className="form-field">
        <label>Magasin</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      {theoreticalItem && <p className="section-subtitle">Quantité théorique actuelle : <strong>{theoreticalItem.quantity}</strong></p>}
      <div className="form-row">
        <div className="form-field"><label>Quantité comptée</label><input required type="number" min="0" value={countedQty} onChange={(event) => setCountedQty(event.target.value)} /></div>
        <div className="form-field"><label>Date du comptage</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      </div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer le comptage'}</button></div>
    </form>
  )
}

function EditStockCountForm({ row, onSaved }: { row: StockCountRow; onSaved: () => void }) {
  const [countedQty, setCountedQty] = useState(String(row.countedQty))
  const [date, setDate] = useState((row.ownDate ?? '').slice(0, 10))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/stock/count/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countedQty, date: date || null, reason: reason || undefined }),
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
      <p className="section-subtitle">{row.productName} ({row.sku}) — {row.storeName} · Théorique à l’époque : <strong>{row.theoreticalQty}</strong></p>
      <div className="form-row">
        <div className="form-field"><label>Quantité comptée corrigée</label><input required type="number" min="0" value={countedQty} onChange={(event) => setCountedQty(event.target.value)} /></div>
        <div className="form-field"><label>Date du comptage</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeleteStockCountConfirm({ row, onClose, onDone }: { row: StockCountRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/stock/count/${row.id}`, {
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
        L’écart appliqué par ce comptage ({row.variance > 0 ? `+${row.variance}` : row.variance}) sera retiré du stock actuel de
        {' '}{row.productName} — {row.storeName}. Le comptage reste visible en base (avec qui et quand) à des fins d’audit, mais
        disparaît de la liste.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder le comptage</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer le comptage'}</button>
      </div>
    </div>
  )
}

function EditReceptionForm({
  row,
  storeOptions,
  productOptions,
  onSaved,
}: {
  row: StockReceptionRow
  storeOptions: StoreOption[]
  productOptions: ProductOption[]
  onSaved: () => void
}) {
  const [storeId, setStoreId] = useState(String(row.storeId))
  const [items, setItems] = useState<ReceptionItemRow[]>(row.items.map((item) => ({ productId: String(item.productId), quantity: String(item.quantity) })))
  const [reference, setReference] = useState(row.reference ?? '')
  const [date, setDate] = useState((row.date ?? '').slice(0, 10))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/stock/receptions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, items, reference, date: date || undefined, reason: reason || undefined }),
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
      <p className="section-subtitle">
        La quantité déjà ajoutée au stock est retirée, puis la quantité corrigée est appliquée — comme si la réception avait été
        saisie correctement du premier coup.
      </p>
      <div className="form-field">
        <label>Magasin</label>
        <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
          {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>

      <ReceptionItemRows items={items} productOptions={productOptions} onChange={setItems} />

      <div className="form-row">
        <div className="form-field"><label>Date de réception</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div className="form-field"><label>Référence (optionnel)</label><input value={reference} onChange={(event) => setReference(event.target.value)} /></div>
      </div>
      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function DeleteReceptionConfirm({ row, onClose, onDone }: { row: StockReceptionRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleDelete() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/stock/receptions/${row.id}`, {
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
        {row.items.map((item) => `${item.quantity} × ${item.productName}`).join(', ')} seront retirés du stock de {row.storeName}. La
        réception reste visible en base (avec qui et quand) à des fins d’audit, mais disparaît de la liste.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder la réception</button>
        <button type="button" className="btn-primary" onClick={handleDelete} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer la réception'}</button>
      </div>
    </div>
  )
}

export function StockView() {
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user?.role === 'admin'
  const [store, setStore] = useState('Tous les magasins')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StockItem['status']>('all')
  const [data, setData] = useState<StockData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [receptionModalOpen, setReceptionModalOpen] = useState(false)
  const [countModalOpen, setCountModalOpen] = useState(false)
  const [counts, setCounts] = useState<StockCountRow[]>([])
  const [editingCount, setEditingCount] = useState<StockCountRow | null>(null)
  const [deletingCount, setDeletingCount] = useState<StockCountRow | null>(null)
  const [receptions, setReceptions] = useState<StockReceptionRow[]>([])
  const [editingReception, setEditingReception] = useState<StockReceptionRow | null>(null)
  const [deletingReception, setDeletingReception] = useState<StockReceptionRow | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ store })
    fetchJson<StockData>(`/api/stock?${params.toString()}`)
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
  }, [store, refreshKey])

  useEffect(() => {
    fetchJson<{ stores: StoreOption[] }>('/api/magasins').then((json) => setStoreOptions(json.stores)).catch(() => {})
    fetchJson<{ products: ProductOption[] }>('/api/products').then((json) => setProductOptions(json.products)).catch(() => {})
  }, [refreshKey])

  useEffect(() => {
    const params = new URLSearchParams({ store })
    fetchJson<{ counts: StockCountRow[] }>(`/api/stock/count?${params.toString()}`)
      .then((json) => setCounts(json.counts ?? []))
      .catch(() => {})
    fetchJson<{ receptions: StockReceptionRow[] }>(`/api/stock/receptions?${params.toString()}`)
      .then((json) => setReceptions(json.receptions ?? []))
      .catch(() => {})
  }, [store, refreshKey])

  const stores = data?.stores ?? ['Tous les magasins']
  const filteredItems = useMemo(() => {
    let items = data?.items ?? []
    if (statusFilter !== 'all') items = items.filter((item) => item.status === statusFilter)
    const query = search.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) => item.name.toLowerCase().includes(query) || item.sku.toLowerCase().includes(query) || item.category.toLowerCase().includes(query))
  }, [data, search, statusFilter])

  function refresh() {
    setProductModalOpen(false)
    setReceptionModalOpen(false)
    setCountModalOpen(false)
    setRefreshKey((key) => key + 1)
  }

  // Unlike refresh(), doesn't close the import modal — the import report (imported/skipped rows)
  // needs to stay visible after a successful import instead of vanishing immediately.
  function refreshData() {
    setRefreshKey((key) => key + 1)
  }

  return (
    <AppShell breadcrumb="Gestion" section="Stock" onExport={() => downloadCsv(`/api/stock?${new URLSearchParams({ store, format: 'csv' }).toString()}`, 'stock.csv')}>
      <section className="page-heading">
        <div><p className="eyebrow">INVENTAIRE</p><h1>Stock <span>par magasin</span></h1><p className="heading-subtitle">Suivez les niveaux de stock et les articles à réapprovisionner.</p></div>
        <div className="filter-row">
          <label className="select-wrap"><span className="sr-only">Magasin</span><select value={store} onChange={(event) => setStore(event.target.value)}>{stores.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs stock">
        {loading ? <SkeletonCards count={4} /> : (
          <>
            <MetricCard label="Articles référencés" value={`${data?.summary.totalArticles ?? 0}`} icon={Package} tone="navy" />
            <MetricCard label="Quantité totale" value={`${data?.summary.totalQuantity ?? 0}`} icon={Layers} tone="blue" />
            <MetricCard label="Articles en alerte" value={`${data?.summary.lowCount ?? 0}`} icon={AlertTriangle} tone="orange" />
            <MetricCard label="Valeur du stock" value={data?.summary.stockValue ?? '—'} icon={Wallet} tone="green" />
          </>
        )}
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <input placeholder="Rechercher un article, une référence..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher un article" />
        </div>
        <button className="btn-secondary" onClick={() => setReceptionModalOpen(true)}><PackagePlus size={14} /> Réception stock</button>
        <button className="btn-secondary" onClick={() => setCountModalOpen(true)}><ClipboardCheck size={14} /> Comptage physique</button>
        <button className="btn-secondary" onClick={() => setImportModalOpen(true)}><Upload size={14} /> Importer un catalogue</button>
        {isAdmin && <button className="btn-primary" onClick={() => setProductModalOpen(true)}><Plus size={14} /> Nouvel article</button>}
      </div>

      <div className="filter-chip-row" role="group" aria-label="Filtrer par statut">
        <button type="button" className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>Tous</button>
        <button type="button" className={`filter-chip ${statusFilter === 'critical' ? 'active' : ''}`} onClick={() => setStatusFilter('critical')}>Critique</button>
        <button type="button" className={`filter-chip ${statusFilter === 'low' ? 'active' : ''}`} onClick={() => setStatusFilter('low')}>Faible</button>
        <button type="button" className={`filter-chip ${statusFilter === 'ok' ? 'active' : ''}`} onClick={() => setStatusFilter('ok')}>OK</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>SKU</th>
                <th>Catégorie</th>
                <th>Magasin</th>
                <th>Quantité</th>
                <th>Seuil</th>
                <th>Prix unitaire</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows count={6} />}
              {!loading && filteredItems.map((item) => (
                <tr key={`${item.sku}-${item.store}`}>
                  <td data-label="Produit">{item.name}</td>
                  <td data-label="SKU" className="cell-secondary">{item.sku}</td>
                  <td data-label="Catégorie" className="cell-secondary">{item.category}</td>
                  <td data-label="Magasin">{item.store}</td>
                  <td data-label="Quantité">{item.quantity}</td>
                  <td data-label="Seuil" className="cell-secondary">{item.threshold}</td>
                  <td data-label="Prix unitaire" className="cell-secondary">{item.unitPrice}</td>
                  <td data-label="Statut"><span className={`badge ${statusBadge[item.status]}`}>{statusLabel[item.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredItems.length === 0 && <p className="table-empty">Aucun article ne correspond à votre recherche.</p>}
        </div>
      </div>

      {counts.length > 0 && (
        <div className="table-panel" style={{ marginTop: 20 }}>
          <div className="table-scroll">
            <p className="section-title" style={{ padding: '16px 18px 0' }}>Écarts récents</p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Produit</th>
                  <th>Magasin</th>
                  <th>Théorique</th>
                  <th>Compté</th>
                  <th>Écart</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {counts.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{new Date(row.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td data-label="Produit">{row.productName} ({row.sku})</td>
                    <td data-label="Magasin">{row.storeName}</td>
                    <td data-label="Théorique">{row.theoreticalQty}</td>
                    <td data-label="Compté">{row.countedQty}</td>
                    <td data-label="Écart" style={{ color: row.variance === 0 ? undefined : row.variance > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{row.variance > 0 ? `+${row.variance}` : row.variance}</td>
                    {isAdmin && (
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn-ghost" onClick={() => setEditingCount(row)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                        <button className="btn-ghost" onClick={() => setDeletingCount(row)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {receptions.length > 0 && (
        <div className="table-panel" style={{ marginTop: 20 }}>
          <div className="table-scroll">
            <p className="section-title" style={{ padding: '16px 18px 0' }}>Réceptions récentes</p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Articles</th>
                  <th>Magasin</th>
                  <th>Référence</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {receptions.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{new Date(row.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td data-label="Articles" style={{ fontWeight: 700 }}>{row.items.map((item) => `${item.productName} +${item.quantity}`).join(', ')}</td>
                    <td data-label="Magasin">{row.storeName}</td>
                    <td data-label="Référence">{row.reference ?? '—'}</td>
                    {isAdmin && (
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn-ghost" onClick={() => setEditingReception(row)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                        <button className="btn-ghost" onClick={() => setDeletingReception(row)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={countModalOpen} onClose={() => setCountModalOpen(false)} title="Comptage physique" subtitle="Comparez le stock compté au stock théorique et ajustez le système.">
        <StockCountForm storeOptions={storeOptions} productOptions={productOptions} stockItems={data?.items ?? []} onCreated={refresh} />
      </Modal>
      <Modal open={editingReception !== null} onClose={() => setEditingReception(null)} title="Modifier la réception" subtitle="Corrigez l’article, la quantité ou la date de réception.">
        {editingReception && (
          <EditReceptionForm
            row={editingReception}
            storeOptions={storeOptions}
            productOptions={productOptions}
            onSaved={() => { setEditingReception(null); refresh() }}
          />
        )}
      </Modal>
      <Modal open={deletingReception !== null} onClose={() => setDeletingReception(null)} title="Supprimer cette réception ?" subtitle="">
        {deletingReception && (
          <DeleteReceptionConfirm row={deletingReception} onClose={() => setDeletingReception(null)} onDone={() => { setDeletingReception(null); refresh() }} />
        )}
      </Modal>
      <Modal open={editingCount !== null} onClose={() => setEditingCount(null)} title="Modifier le comptage" subtitle="">
        {editingCount && <EditStockCountForm row={editingCount} onSaved={() => { setEditingCount(null); refresh() }} />}
      </Modal>
      <Modal open={deletingCount !== null} onClose={() => setDeletingCount(null)} title="Supprimer ce comptage ?" subtitle="">
        {deletingCount && (
          <DeleteStockCountConfirm row={deletingCount} onClose={() => setDeletingCount(null)} onDone={() => { setDeletingCount(null); refresh() }} />
        )}
      </Modal>

      <Modal open={productModalOpen} onClose={() => setProductModalOpen(false)} title="Nouvel article" subtitle="Ajoutez un article au catalogue et son stock de départ.">
        <NewProductForm storeOptions={storeOptions} onCreated={refresh} />
      </Modal>
      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Importer un catalogue" subtitle="Ajoutez plusieurs articles d’un coup depuis un fichier Excel ou CSV.">
        <ImportProductsForm storeOptions={storeOptions} onImported={refreshData} />
      </Modal>
      <Modal open={receptionModalOpen} onClose={() => setReceptionModalOpen(false)} title="Réception stock" subtitle="Enregistrez l’arrivée d’articles dans un magasin.">
        <StockReceptionForm storeOptions={storeOptions} productOptions={productOptions} onCreated={refresh} />
      </Modal>
    </AppShell>
  )
}
