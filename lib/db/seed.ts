import { db } from './client'
import {
  clients,
  discountApplications,
  discountScales,
  discountTiers,
  payments,
  products,
  receivables,
  saleItems,
  sales,
  stockCounts,
  stockLevels,
  stockMovements,
  stores,
  supplierDeliveries,
  supplierPayables,
  supplierPayments,
  suppliers,
  transferItems,
  transfers,
} from './schema'

// Catalogue générique de démo — à remplacer par les vrais produits/prix du client avant mise en
// production. `sackWeightKg` porte ici le nombre de pièces par carton (voir lib/business-config.ts).
function daysAgo(days: number, hours = 0, minutes = 0) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(date.getHours() - hours, date.getMinutes() - minutes)
  return date.toISOString()
}

async function seed() {
  console.log('Seeding database...')

  await db.delete(transferItems)
  await db.delete(transfers)
  await db.delete(receivables)
  await db.delete(payments)
  await db.delete(saleItems)
  await db.delete(sales)
  await db.delete(discountApplications)
  await db.delete(discountTiers)
  await db.delete(discountScales)
  await db.delete(supplierPayables)
  await db.delete(supplierDeliveries)
  await db.delete(supplierPayments)
  await db.delete(suppliers)
  await db.delete(stockCounts)
  await db.delete(stockMovements)
  await db.delete(stockLevels)
  await db.delete(clients)
  await db.delete(products)
  await db.delete(stores)

  const [kaloum, madina, matam] = await db
    .insert(stores)
    .values([
      { name: 'BILMS Kaloum', city: 'Conakry' },
      { name: 'BILMS Madina', city: 'Conakry' },
      { name: 'BILMS Matam', city: 'Conakry' },
    ])
    .returning()

  const productRows = await db
    .insert(products)
    .values([
      { name: 'Savon de toilette parfumé', sku: 'SAV-TOI-01', category: 'Savon de toilette', unitPrice: 5000, costPrice: 3500, reorderThreshold: 100, sackWeightKg: 72 },
      { name: 'Savon de ménage', sku: 'SAV-MEN-01', category: 'Savon de ménage', unitPrice: 4000, costPrice: 2800, reorderThreshold: 150, sackWeightKg: 48 },
      { name: 'Savon liquide (bidon)', sku: 'SAV-LIQ-01', category: 'Savon liquide', unitPrice: 25000, costPrice: 18000, reorderThreshold: 20, sackWeightKg: 12 },
      { name: 'Savon antiseptique', sku: 'SAV-ANT-01', category: 'Savon antiseptique', unitPrice: 6000, costPrice: 4200, reorderThreshold: 80, sackWeightKg: 60 },
    ])
    .returning()

  const [sToi, sMen, sLiq, sAnt] = productRows

  const storeList = [kaloum, madina, matam]
  const stockRows: { productId: number; storeId: number; quantity: number }[] = []
  for (const store of storeList) {
    for (const product of productRows) {
      const base = Math.floor(Math.random() * 200) + 20
      stockRows.push({ productId: product.id, storeId: store.id, quantity: base })
    }
  }
  stockRows.find((row) => row.productId === sMen.id && row.storeId === kaloum.id)!.quantity = 30
  stockRows.find((row) => row.productId === sAnt.id && row.storeId === madina.id)!.quantity = 15
  stockRows.find((row) => row.productId === sLiq.id && row.storeId === matam.id)!.quantity = 5
  await db.insert(stockLevels).values(stockRows)

  const clientRows = await db
    .insert(clients)
    .values([
      { name: 'Boutique Alpha', phone: '620 11 22 33', storeId: kaloum.id },
      { name: 'Supermarché Centrale', phone: '621 44 55 66', storeId: madina.id },
      { name: 'Quincaillerie Fatoumata', phone: '622 77 88 99', storeId: matam.id },
      { name: 'Dépôt Thierno', phone: '623 00 11 22', storeId: kaloum.id },
      { name: 'Boutique Diaraye', phone: '624 33 44 55', storeId: madina.id },
    ])
    .returning()

  const salesPlan = [
    { store: kaloum, ref: 'BL-1012', daysAgo: 0, hours: 0, minutes: 8, status: 'paid' as const, client: null },
    { store: kaloum, ref: 'BL-1011', daysAgo: 0, hours: 3, minutes: 0, status: 'paid' as const, client: null },
    { store: madina, ref: 'BL-1010', daysAgo: 1, hours: 2, minutes: 0, status: 'credit' as const, client: clientRows[1] },
    { store: matam, ref: 'BL-1009', daysAgo: 1, hours: 6, minutes: 0, status: 'paid' as const, client: null },
    { store: kaloum, ref: 'BL-1008', daysAgo: 2, hours: 1, minutes: 0, status: 'partial' as const, client: clientRows[0] },
    { store: madina, ref: 'BL-1007', daysAgo: 2, hours: 5, minutes: 0, status: 'paid' as const, client: null },
    { store: matam, ref: 'BL-1006', daysAgo: 3, hours: 0, minutes: 0, status: 'paid' as const, client: null },
    { store: kaloum, ref: 'BL-1005', daysAgo: 4, hours: 0, minutes: 0, status: 'credit' as const, client: clientRows[3] },
    { store: madina, ref: 'BL-1004', daysAgo: 5, hours: 0, minutes: 0, status: 'paid' as const, client: null },
    { store: matam, ref: 'BL-1003', daysAgo: 6, hours: 0, minutes: 0, status: 'paid' as const, client: null },
    { store: kaloum, ref: 'BL-1002', daysAgo: 6, hours: 4, minutes: 0, status: 'paid' as const, client: null },
    { store: madina, ref: 'BL-1001', daysAgo: 7, hours: 0, minutes: 0, status: 'partial' as const, client: clientRows[4] },
  ]

  const catalog = [sToi, sMen, sLiq, sAnt]

  for (const plan of salesPlan) {
    const itemCount = Math.floor(Math.random() * 3) + 1
    const chosen = [...catalog].sort(() => Math.random() - 0.5).slice(0, itemCount)
    const items = chosen.map((product) => {
      const quantity = Math.floor(Math.random() * 40) + 10
      return { productId: product.id, quantity, unitPrice: product.unitPrice, costPrice: product.costPrice }
    })
    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const costAmount = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0)

    const [sale] = await db
      .insert(sales)
      .values({
        reference: plan.ref,
        storeId: plan.store.id,
        clientId: plan.client?.id ?? null,
        totalAmount,
        costAmount,
        paymentStatus: plan.status,
        createdAt: daysAgo(plan.daysAgo, plan.hours, plan.minutes),
      })
      .returning()

    await db.insert(saleItems).values(
      items.map((item) => ({ saleId: sale.id, productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
    )

    for (const item of items) {
      await db.insert(stockMovements).values({
        type: 'sale',
        productId: item.productId,
        storeId: plan.store.id,
        quantity: -item.quantity,
        reference: sale.reference,
        createdAt: sale.createdAt,
      })
    }

    if (plan.status === 'credit' || plan.status === 'partial') {
      const paidPortion = plan.status === 'partial' ? Math.round(totalAmount * 0.4) : 0
      if (paidPortion > 0 && plan.client) {
        await db.insert(payments).values({
          clientId: plan.client.id,
          saleId: sale.id,
          storeId: plan.store.id,
          amount: paidPortion,
          method: 'cash',
          createdAt: sale.createdAt,
        })
      }
      if (plan.client) {
        const due = new Date(sale.createdAt)
        due.setDate(due.getDate() + 15)
        const overdue = due.getTime() < Date.now()
        await db.insert(receivables).values({
          clientId: plan.client.id,
          saleId: sale.id,
          amount: totalAmount - paidPortion,
          dueDate: due.toISOString(),
          status: overdue ? 'overdue' : 'pending',
        })
      }
    }
  }

  await db.insert(payments).values({
    clientId: clientRows[0].id,
    saleId: null,
    storeId: kaloum.id,
    amount: 80000,
    method: 'cash',
    createdAt: daysAgo(0, 1, 0),
  })

  await db.insert(stockMovements).values({
    type: 'reception',
    productId: sToi.id,
    storeId: madina.id,
    quantity: 144,
    reference: 'RCP-2001',
    createdAt: daysAgo(0, 0, 24),
  })

  const [transfer] = await db
    .insert(transfers)
    .values({
      reference: 'TR-010',
      fromStoreId: kaloum.id,
      toStoreId: matam.id,
      status: 'in_transit',
      createdAt: daysAgo(0, 2, 0),
    })
    .returning()

  await db.insert(transferItems).values([
    { transferId: transfer.id, productId: sMen.id, quantity: 48 },
    { transferId: transfer.id, productId: sAnt.id, quantity: 24 },
  ])

  console.log('Database seeded successfully.')
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
