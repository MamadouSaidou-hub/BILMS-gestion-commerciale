'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, CreditCard, Pencil, Plus, Receipt, ScanLine, Search, ShoppingCart, Trash2, WalletCards } from 'lucide-react'
import { AppShell } from '@/components/app-shell'
import { Modal } from '@/components/modal'
import { LoadError } from '@/components/load-error'
import { SkeletonCards, SkeletonRows } from '@/components/skeleton'
import { downloadCsv } from '@/lib/download-csv'
import { fetchJson } from '@/lib/fetch-json'
import { businessConfig } from '@/lib/business-config'
import { authClient } from '@/lib/auth-client'

const periods = ['Aujourd’hui', '7 derniers jours', 'Ce mois-ci']

type Sale = {
  reference: string
  date: string
  store: string
  client: string
  amount: string
  status: 'paid' | 'partial' | 'credit'
}

type SalesData = {
  sales: Sale[]
  summary: { count: number; totalRevenue: string; avgBasket: string; creditCount: number }
  stores: string[]
}

type StoreOption = { id: number; name: string }
type ClientOption = { id: number; name: string }
type ProductOption = { id: number; name: string; sku: string; unitPrice: number; sackWeightKg: number | null; unit: 'sack' | 'carton' }
type ItemRow = { productId: string; quantity: string; unitPrice: string }

const unitLabel = { sack: 'Sac', carton: 'Carton' }

const statusLabel = { paid: 'Payée', partial: 'Partielle', credit: 'Crédit' }
const statusBadge = { paid: 'badge-green', partial: 'badge-orange', credit: 'badge-blue' }

// A short beep synthesized with the Web Audio API — no audio file to ship/host, works offline.
// Higher pitch + single beep for a recognized scan, lower pitch + double beep for an unknown one,
// so a cashier scanning without looking at the screen can tell success from failure by ear alone.
function playScanSound(kind: 'success' | 'error') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const beeps = kind === 'success' ? [{ freq: 880, at: 0 }] : [{ freq: 220, at: 0 }, { freq: 220, at: 0.12 }]
    for (const beep of beeps) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = beep.freq
      gain.gain.setValueAtTime(0.15, ctx.currentTime + beep.at)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + beep.at + 0.1)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(ctx.currentTime + beep.at)
      oscillator.stop(ctx.currentTime + beep.at + 0.1)
    }
    setTimeout(() => ctx.close(), 400)
  } catch {
    // Audio isn't essential to the scan working — never let a sound failure block a sale.
  }
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof ShoppingCart; tone: 'navy' | 'green' | 'orange' | 'blue' }) {
  return (
    <article className="metric-card">
      <div className="metric-topline"><span className={`metric-icon metric-icon-${tone}`}><Icon aria-hidden="true" /></span></div>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
    </article>
  )
}

function NewSaleForm({
  storeOptions,
  clientOptions,
  productOptions,
  onCreated,
}: {
  storeOptions: StoreOption[]
  clientOptions: ClientOption[]
  productOptions: ProductOption[]
  onCreated: () => void
}) {
  const [storeId, setStoreId] = useState('')
  const [clientId, setClientId] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partial' | 'credit'>('paid')
  const [paidNow, setPaidNow] = useState('')
  const [dueInDays, setDueInDays] = useState('15')
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState<ItemRow[]>([{ productId: '', quantity: '1', unitPrice: '' }])
  const [scanCode, setScanCode] = useState('')
  const [scanError, setScanError] = useState('')
  const [scanFeedback, setScanFeedback] = useState<'success' | 'error' | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!storeId && storeOptions.length > 0) setStoreId(String(storeOptions[0].id))
  }, [storeOptions, storeId])

  const productMap = useMemo(() => new Map(productOptions.map((product) => [String(product.id), product])), [productOptions])

  const total = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0)

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function handleProductChange(index: number, productId: string) {
    const product = productMap.get(productId)
    updateItem(index, { productId, unitPrice: product ? String(product.unitPrice) : '' })
  }

  function addItem() {
    setItems((rows) => [...rows, { productId: '', quantity: '1', unitPrice: '' }])
  }

  function flashScanFeedback(kind: 'success' | 'error') {
    playScanSound(kind)
    setScanFeedback(kind)
    window.setTimeout(() => setScanFeedback(null), 350)
  }

  // A barcode scanner behaves exactly like a keyboard typing fast, then pressing Enter — so a
  // plain text input with an Enter handler is all scanning needs, no special hardware integration.
  // The scanned code only ever picks WHICH product goes in the cart; the price is still whatever
  // the catalog says (same `handleProductChange`/`productMap` path as the dropdown), never trusted
  // from the barcode itself.
  //
  // Pressing Enter on an EMPTY scan field submits the sale instead of looking anything up — lets a
  // cashier finish a sale with the keyboard alone (scan items, then one more Enter) instead of
  // reaching for the mouse to click "Enregistrer".
  function handleScan(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const code = scanCode.trim()
    setScanCode('')

    if (!code) {
      formRef.current?.requestSubmit()
      return
    }

    const product = productOptions.find((option) => option.sku.toLowerCase() === code.toLowerCase())
    if (!product) {
      setScanError(`Code-barres inconnu : ${code}`)
      flashScanFeedback('error')
      scanInputRef.current?.focus()
      return
    }
    setScanError('')
    flashScanFeedback('success')
    scanInputRef.current?.focus()

    setItems((rows) => {
      const existingRowIndex = rows.findIndex((row) => row.productId === String(product.id))
      if (existingRowIndex !== -1) {
        return rows.map((row, i) => (i === existingRowIndex ? { ...row, quantity: String((Number(row.quantity) || 0) + 1) } : row))
      }
      const scannedRow: ItemRow = { productId: String(product.id), quantity: '1', unitPrice: String(product.unitPrice) }
      const emptyRowIndex = rows.findIndex((row) => !row.productId)
      if (emptyRowIndex !== -1) {
        return rows.map((row, i) => (i === emptyRowIndex ? scannedRow : row))
      }
      return [...rows, scannedRow]
    })
  }

  function removeItem(index: number) {
    setItems((rows) => rows.filter((_, i) => i !== index))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (paymentStatus !== 'paid' && !clientId) {
      setError('Un client est requis pour une vente partielle ou à crédit.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/ventes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          clientId: clientId || null,
          paymentStatus,
          paidNow: paymentStatus === 'partial' ? paidNow : 0,
          dueInDays,
          saleDate,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Une erreur est survenue.')
        return
      }
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-row">
        <div className="form-field">
          <label>Magasin</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Client (optionnel)</label>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Vente comptoir</option>
            {clientOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Date de la vente</label>
          <input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
        </div>
      </div>

      <div className="form-field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ScanLine size={14} /> Scanner un code-barres</label>
        <input
          ref={scanInputRef}
          autoFocus
          value={scanCode}
          onChange={(event) => setScanCode(event.target.value)}
          onKeyDown={handleScan}
          placeholder="Code-barres puis Entrée"
          style={{
            transition: 'background-color .15s, border-color .15s',
            backgroundColor: scanFeedback === 'success' ? 'var(--tint-green, #e6f7ea)' : scanFeedback === 'error' ? 'var(--tint-red, #fbe9e8)' : undefined,
            borderColor: scanFeedback === 'success' ? 'var(--green, #2e9e3f)' : scanFeedback === 'error' ? 'var(--red, #d1453d)' : undefined,
          }}
        />
        <p className="section-subtitle" style={{ marginTop: 4, marginBottom: 0 }}>Entrée à vide = valider la vente</p>
        {scanError && <p className="form-error" style={{ marginTop: 4 }}>{scanError}</p>}
      </div>

      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Articles</label>
      {items.map((item, index) => {
        const product = productMap.get(item.productId)
        return (
          <div key={index} style={{ marginBottom: 10 }}>
            <div className="item-row-grid">
              <div className="form-field" style={{ marginBottom: 0 }}>
                <select required value={item.productId} onChange={(event) => handleProductChange(index, event.target.value)}>
                  <option value="">Sélectionner...</option>
                  {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}>
                <input
                  required
                  type="number"
                  min="1"
                  placeholder={`Qté${product ? ` (${unitLabel[product.unit]})` : ''}`}
                  value={item.quantity}
                  onChange={(event) => updateItem(index, { quantity: event.target.value })}
                />
              </div>
              <div className="form-field" style={{ marginBottom: 0 }}><input required type="number" min="0" placeholder="Prix" value={item.unitPrice} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} /></div>
              <button type="button" className="item-row-remove" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label="Retirer la ligne"><Trash2 size={14} /></button>
            </div>
          </div>
        )
      })}
      <button type="button" className="item-add-link" onClick={addItem}><Plus size={13} /> Ajouter un article</button>

      <div className="sale-total-row"><span>Total</span><span>{total.toLocaleString('fr-FR')} {businessConfig.currency}</span></div>

      <div className="form-row">
        <div className="form-field">
          <label>Statut de paiement</label>
          <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as typeof paymentStatus)}>
            <option value="paid">Payée comptant</option>
            <option value="partial">Paiement partiel</option>
            <option value="credit">À crédit</option>
          </select>
        </div>
        {paymentStatus === 'partial' && (
          <div className="form-field"><label>Montant payé maintenant</label><input required type="number" min="0" max={total} value={paidNow} onChange={(event) => setPaidNow(event.target.value)} /></div>
        )}
        {paymentStatus !== 'paid' && (
          <div className="form-field"><label>Échéance (jours)</label><input required type="number" min="1" value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} /></div>
        )}
      </div>

      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer la vente'}</button></div>
    </form>
  )
}

type SaleForEdit = {
  reference: string
  storeId: number
  clientId: number | null
  paymentStatus: 'paid' | 'partial' | 'credit'
  saleDate: string | null
  paidNow: number
  items: { productId: number; quantity: number; unitPrice: number }[]
}

function EditSaleForm({
  reference,
  storeOptions,
  clientOptions,
  productOptions,
  onSaved,
}: {
  reference: string
  storeOptions: StoreOption[]
  clientOptions: ClientOption[]
  productOptions: ProductOption[]
  onSaved: () => void
}) {
  const [sale, setSale] = useState<SaleForEdit | null>(null)
  const [storeId, setStoreId] = useState('')
  const [clientId, setClientId] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'partial' | 'credit'>('paid')
  const [paidNow, setPaidNow] = useState('')
  const [dueInDays, setDueInDays] = useState('15')
  const [saleDate, setSaleDate] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchJson<{ sale: SaleForEdit }>(`/api/ventes/${reference}`)
      .then((json) => {
        setSale(json.sale)
        setStoreId(String(json.sale.storeId))
        setClientId(json.sale.clientId ? String(json.sale.clientId) : '')
        setPaymentStatus(json.sale.paymentStatus)
        setPaidNow(json.sale.paidNow ? String(json.sale.paidNow) : '')
        setSaleDate(json.sale.saleDate ?? '')
        setItems(json.sale.items.map((item) => ({ productId: String(item.productId), quantity: String(item.quantity), unitPrice: String(item.unitPrice) })))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue.'))
  }, [reference])

  const total = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0)

  function updateItem(index: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addItem() {
    setItems((rows) => [...rows, { productId: '', quantity: '1', unitPrice: '' }])
  }

  function removeItem(index: number) {
    setItems((rows) => rows.filter((_, i) => i !== index))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ventes/${reference}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          clientId: clientId || null,
          paymentStatus,
          paidNow: paymentStatus === 'partial' ? paidNow : 0,
          dueInDays,
          saleDate: saleDate || null,
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
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

  if (!sale) return error ? <p className="form-error">{error}</p> : <p className="section-subtitle">Chargement...</p>

  return (
    <form onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}
      <div className="form-row">
        <div className="form-field">
          <label>Magasin</label>
          <select required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
            {storeOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Client (optionnel)</label>
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Vente comptoir</option>
            {clientOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Date de la vente</label>
          <input type="date" value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
        </div>
      </div>

      <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Articles</label>
      {items.map((item, index) => {
        const product = productOptions.find((option) => String(option.id) === item.productId)
        return (
          <div className="item-row-grid" key={index} style={{ marginBottom: 10 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <select required value={item.productId} onChange={(event) => updateItem(index, { productId: event.target.value })}>
                <option value="">Sélectionner...</option>
                {productOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <input
                required
                type="number"
                min="1"
                placeholder={`Qté${product ? ` (${unitLabel[product.unit]})` : ''}`}
                value={item.quantity}
                onChange={(event) => updateItem(index, { quantity: event.target.value })}
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}><input required type="number" min="0" placeholder="Prix" value={item.unitPrice} onChange={(event) => updateItem(index, { unitPrice: event.target.value })} /></div>
            <button type="button" className="item-row-remove" onClick={() => removeItem(index)} disabled={items.length === 1} aria-label="Retirer la ligne"><Trash2 size={14} /></button>
          </div>
        )
      })}
      <button type="button" className="item-add-link" onClick={addItem}><Plus size={13} /> Ajouter un article</button>

      <div className="sale-total-row"><span>Total</span><span>{total.toLocaleString('fr-FR')} {businessConfig.currency}</span></div>

      <div className="form-row">
        <div className="form-field">
          <label>Statut de paiement</label>
          <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as typeof paymentStatus)}>
            <option value="paid">Payée comptant</option>
            <option value="partial">Paiement partiel</option>
            <option value="credit">À crédit</option>
          </select>
        </div>
        {paymentStatus === 'partial' && (
          <div className="form-field"><label>Montant payé maintenant</label><input required type="number" min="0" max={total} value={paidNow} onChange={(event) => setPaidNow(event.target.value)} /></div>
        )}
        {paymentStatus !== 'paid' && (
          <div className="form-field"><label>Échéance (jours)</label><input required type="number" min="1" value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} /></div>
        )}
      </div>

      <div className="form-field"><label>Motif de la correction (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>

      <div className="form-actions"><button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}</button></div>
    </form>
  )
}

function CancelSaleConfirm({ sale, onDone, onClose }: { sale: Sale; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleCancel() {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ventes/${sale.reference}/annuler`, {
        method: 'POST',
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
        Le stock vendu sera restauré. Les paiements/créances liés à cette vente seront supprimés. La vente reste visible dans
        l’historique (marquée supprimée, avec qui et quand) mais disparaît des listes et des totaux.
      </p>
      <div className="form-field"><label>Motif (optionnel)</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Garder la vente</button>
        <button type="button" className="btn-primary" onClick={handleCancel} disabled={submitting}>{submitting ? 'Suppression...' : 'Supprimer la vente'}</button>
      </div>
    </div>
  )
}

export function SalesView() {
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user?.role === 'admin'
  const [period, setPeriod] = useState(periods[1])
  const [store, setStore] = useState('Tous les magasins')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([])
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  const [cancellingSale, setCancellingSale] = useState<Sale | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ period, store })
    fetchJson<SalesData>(`/api/ventes?${params.toString()}`)
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
  }, [period, store, refreshKey])

  useEffect(() => {
    fetchJson<{ stores: StoreOption[] }>('/api/magasins').then((json) => setStoreOptions(json.stores)).catch(() => {})
    fetchJson<{ clients: ClientOption[] }>('/api/clients/options').then((json) => setClientOptions(json.clients)).catch(() => {})
    fetchJson<{ products: ProductOption[] }>('/api/products').then((json) => setProductOptions(json.products)).catch(() => {})
  }, [refreshKey])

  const stores = data?.stores ?? ['Tous les magasins']
  const filteredSales = useMemo(() => {
    const rows = data?.sales ?? []
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => row.reference.toLowerCase().includes(query) || row.client.toLowerCase().includes(query))
  }, [data, search])

  return (
    <AppShell breadcrumb="Pilotage" section="Ventes" onExport={() => downloadCsv(`/api/ventes?${new URLSearchParams({ period, store, format: 'csv' }).toString()}`, 'ventes.csv')}>
      <section className="page-heading">
        <div><p className="eyebrow">TRANSACTIONS</p><h1>Ventes <span>par magasin</span></h1><p className="heading-subtitle">Consultez l’historique des ventes sur la période sélectionnée.</p></div>
        <div className="filter-row">
          <label className="select-wrap"><span className="sr-only">Période</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>{periods.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
          <label className="select-wrap"><span className="sr-only">Magasin</span><select value={store} onChange={(event) => setStore(event.target.value)}>{stores.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown /></label>
        </div>
      </section>

      {error && <LoadError message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}

      <section className="metrics-grid" aria-label="Indicateurs ventes">
        {loading ? <SkeletonCards count={4} /> : (
          <>
            <MetricCard label="Nombre de ventes" value={`${data?.summary.count ?? 0}`} icon={ShoppingCart} tone="navy" />
            <MetricCard label="Chiffre d’affaires" value={data?.summary.totalRevenue ?? '—'} icon={WalletCards} tone="green" />
            <MetricCard label="Panier moyen" value={data?.summary.avgBasket ?? '—'} icon={Receipt} tone="blue" />
            <MetricCard label="Ventes à crédit" value={`${data?.summary.creditCount ?? 0}`} icon={CreditCard} tone="orange" />
          </>
        )}
      </section>

      <div className="toolbar-panel">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <input placeholder="Rechercher une référence, un client..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher une vente" />
        </div>
        <button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={14} /> Nouvelle vente</button>
      </div>

      <div className="table-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Date</th>
                <th>Magasin</th>
                <th>Client</th>
                <th>Montant</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows count={6} />}
              {!loading && filteredSales.map((sale) => (
                <tr key={sale.reference}>
                  <td data-label="Référence">#{sale.reference}</td>
                  <td data-label="Date">{new Date(sale.date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td data-label="Magasin">{sale.store}</td>
                  <td data-label="Client">{sale.client}</td>
                  <td data-label="Montant">{sale.amount}</td>
                  <td data-label="Statut"><span className={`badge ${statusBadge[sale.status]}`}>{statusLabel[sale.status]}</span></td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <a className="btn-ghost" href={`/ventes/${sale.reference}/facture`} target="_blank" rel="noopener noreferrer"><Receipt size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Facture</a>
                    {isAdmin && (
                      <>
                        <button className="btn-ghost" onClick={() => setEditingSale(sale)}><Pencil size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Modifier</button>
                        <button className="btn-ghost" onClick={() => setCancellingSale(sale)}><Trash2 size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Supprimer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredSales.length === 0 && <p className="table-empty">Aucune vente sur cette période.</p>}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nouvelle vente" subtitle="Enregistrez une vente et mettez à jour le stock automatiquement." wide>
        <NewSaleForm
          storeOptions={storeOptions}
          clientOptions={clientOptions}
          productOptions={productOptions}
          onCreated={() => {
            setModalOpen(false)
            setRefreshKey((key) => key + 1)
          }}
        />
      </Modal>
      <Modal open={editingSale !== null} onClose={() => setEditingSale(null)} title={`Modifier — ${editingSale?.reference ?? ''}`} wide>
        {editingSale && (
          <EditSaleForm
            reference={editingSale.reference}
            storeOptions={storeOptions}
            clientOptions={clientOptions}
            productOptions={productOptions}
            onSaved={() => {
              setEditingSale(null)
              setRefreshKey((key) => key + 1)
            }}
          />
        )}
      </Modal>
      <Modal open={cancellingSale !== null} onClose={() => setCancellingSale(null)} title={`Supprimer la vente #${cancellingSale?.reference ?? ''} ?`}>
        {cancellingSale && (
          <CancelSaleConfirm
            sale={cancellingSale}
            onClose={() => setCancellingSale(null)}
            onDone={() => {
              setCancellingSale(null)
              setRefreshKey((key) => key + 1)
            }}
          />
        )}
      </Modal>
    </AppShell>
  )
}
