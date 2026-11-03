import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { products, stockLevels, stores } from '@/lib/db/schema'
import { bulkImportProducts } from '@/lib/db/mutations/products'

const runId = `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

let storeId: number
let otherStoreId: number
const productIds: number[] = []

async function makeStore(suffix: string) {
  const [store] = await db.insert(stores).values({ name: `Magasin ${suffix} ${runId}`, city: 'Test' }).returning()
  return store.id
}

afterAll(async () => {
  for (const id of productIds) {
    await db.delete(stockLevels).where(eq(stockLevels.productId, id))
    await db.delete(products).where(eq(products.id, id))
  }
  await db.delete(stores).where(eq(stores.id, storeId))
  await db.delete(stores).where(eq(stores.id, otherStoreId))
})

describe('bulkImportProducts', () => {
  it('imports valid rows, generating a SKU when none is given, and sets initial stock on the target store only', async () => {
    storeId = await makeStore('A')
    otherStoreId = await makeStore('B')

    const result = await bulkImportProducts({
      storeId,
      rows: [
        { sku: `BAR-${runId}`, name: `Savon import ${runId}`, category: 'Test', unitPrice: 5000, costPrice: 3000, initialQuantity: 10 },
        { name: `Produit sans code ${runId}`, category: 'Test', unitPrice: 2000, costPrice: 1000 },
      ],
    })

    expect(result.imported).toBe(2)
    expect(result.skipped).toEqual([])

    const rows = await db.select().from(products)
    const withBarcode = rows.find((r) => r.sku === `BAR-${runId}`)
    const autoSku = rows.find((r) => r.name === `Produit sans code ${runId}`)
    expect(withBarcode).toBeTruthy()
    expect(autoSku?.sku).toBeTruthy()
    productIds.push(withBarcode!.id, autoSku!.id)

    const targetStock = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, withBarcode!.id), eq(stockLevels.storeId, storeId)))
    const otherStock = await db
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, withBarcode!.id), eq(stockLevels.storeId, otherStoreId)))
    expect(targetStock[0]?.quantity).toBe(10)
    expect(otherStock[0]?.quantity).toBe(0)
  })

  it('skips a row whose barcode is already used by another product, without failing the rest of the batch', async () => {
    const existingSku = `DUP-${runId}`
    const [existing] = await db.insert(products).values({ name: `Déjà là ${runId}`, sku: existingSku, category: 'Test', unitPrice: 1000, costPrice: 500 }).returning()
    productIds.push(existing.id)

    const result = await bulkImportProducts({
      storeId,
      rows: [
        { sku: existingSku, name: `Doublon ${runId}`, category: 'Test', unitPrice: 1000, costPrice: 500 },
        { name: `Ligne suivante OK ${runId}`, category: 'Test', unitPrice: 1500, costPrice: 700 },
      ],
    })

    expect(result.imported).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toMatch(/déjà utilisé/i)

    const [ok] = await db.select().from(products).where(eq(products.name, `Ligne suivante OK ${runId}`))
    expect(ok).toBeTruthy()
    productIds.push(ok.id)
  })

  it('skips rows with missing or invalid fields, reporting the reason per row', async () => {
    const result = await bulkImportProducts({
      storeId,
      rows: [
        { name: '', category: 'Test', unitPrice: 1000, costPrice: 500 },
        { name: `Prix invalide ${runId}`, category: 'Test', unitPrice: 0, costPrice: 500 },
      ],
    })

    expect(result.imported).toBe(0)
    expect(result.skipped).toHaveLength(2)
    expect(result.skipped[0].reason).toMatch(/nom manquant/i)
    expect(result.skipped[1].reason).toMatch(/prix de vente invalide/i)
  })

  it('rejects an import targeting an unknown store', async () => {
    await expect(bulkImportProducts({ storeId: -1, rows: [{ name: 'X', category: 'Test', unitPrice: 1, costPrice: 1 }] })).rejects.toThrow(/magasin/i)
  })
})
