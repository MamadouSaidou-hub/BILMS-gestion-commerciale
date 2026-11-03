import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { companyInfo } from '@/lib/company-info'

export type ImmoReportsData = {
  period: string
  availablePeriods: string[]
  rentCollected: number
  rentCollectedFormatted: string
  rentExpected: number
  rentExpectedFormatted: string
  collectionRate: number
  totalExpenses: number
  totalExpensesFormatted: string
  net: number
  netFormatted: string
  occupancyRate: number
  expensesByCategory: { category: string; amount: number; amountFormatted: string }[]
  topTenants: { id: number; name: string; totalPaid: number; totalPaidFormatted: string }[]
}

const PRIMARY_RGB: [number, number, number] = [11, 46, 92]

export function exportImmoReportPdf(data: ImmoReportsData) {
  const doc = new jsPDF()
  const generatedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(18)
  doc.setTextColor(...PRIMARY_RGB)
  doc.text(`${companyInfo.shortName} — Rapport Immo`, 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(120, 120, 120)
  doc.text(`Mois : ${data.period}  ·  Généré le ${generatedAt}`, 14, 25)

  autoTable(doc, {
    startY: 32,
    head: [['Indicateur', 'Valeur']],
    body: [
      ['Loyers encaissés', data.rentCollectedFormatted],
      ['Loyers attendus', data.rentExpectedFormatted],
      ['Taux de recouvrement', `${data.collectionRate} %`],
      ['Dépenses du mois', data.totalExpensesFormatted],
      ['Résultat net', data.netFormatted],
      ["Taux d'occupation", `${data.occupancyRate} %`],
    ],
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_RGB },
    margin: { left: 14, right: 14 },
  })

  const afterKpis = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  autoTable(doc, {
    startY: afterKpis,
    head: [['Dépenses par catégorie', 'Montant']],
    body: data.expensesByCategory.map((row) => [row.category, row.amountFormatted]),
    theme: 'striped',
    headStyles: { fillColor: PRIMARY_RGB },
    margin: { left: 14, right: 14 },
  })

  const afterExpenses = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10

  autoTable(doc, {
    startY: afterExpenses,
    head: [['Top locataires', 'Encaissé au total']],
    body: data.topTenants.map((row) => [row.name, row.totalPaidFormatted]),
    theme: 'striped',
    headStyles: { fillColor: PRIMARY_RGB },
    margin: { left: 14, right: 14 },
  })

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text(`Page ${i} / ${pageCount}`, pageWidth - 25, doc.internal.pageSize.getHeight() - 8)
  }

  doc.save(`rapport-immo-${data.period}.pdf`)
}

export function exportImmoReportExcel(data: ImmoReportsData) {
  const workbook = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.aoa_to_sheet([
    [`Rapport Immo ${companyInfo.shortName}`],
    [`Mois : ${data.period}`],
    [`Généré le ${new Date().toLocaleString('fr-FR')}`],
    [],
    ['Indicateur', 'Valeur'],
    ['Loyers encaissés (GNF)', data.rentCollected],
    ['Loyers attendus (GNF)', data.rentExpected],
    ['Taux de recouvrement (%)', data.collectionRate],
    ['Dépenses du mois (GNF)', data.totalExpenses],
    ['Résultat net (GNF)', data.net],
    ["Taux d'occupation (%)", data.occupancyRate],
  ])
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Résumé')

  const expensesSheet = XLSX.utils.json_to_sheet(data.expensesByCategory.map((row) => ({ Catégorie: row.category, 'Montant (GNF)': row.amount })))
  XLSX.utils.book_append_sheet(workbook, expensesSheet, 'Dépenses par catégorie')

  const tenantsSheet = XLSX.utils.json_to_sheet(data.topTenants.map((row) => ({ Locataire: row.name, 'Encaissé au total (GNF)': row.totalPaid })))
  XLSX.utils.book_append_sheet(workbook, tenantsSheet, 'Top locataires')

  XLSX.writeFile(workbook, `rapport-immo-${data.period}.xlsx`)
}
