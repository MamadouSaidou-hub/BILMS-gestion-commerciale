import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { companyInfo } from '@/lib/company-info'

export type LocationReportsData = {
  totalBooked: number
  totalBookedFormatted: string
  totalCollectedInPeriod: number
  totalCollectedInPeriodFormatted: string
  totalExpenses: number
  totalExpensesFormatted: string
  net: number
  netFormatted: string
  fleetUtilizationRate: number
  expensesByCategory: { category: string; amount: number; amountFormatted: string }[]
  topClients: { id: number; name: string; totalPaid: number; totalPaidFormatted: string }[]
}

const PRIMARY_RGB: [number, number, number] = [11, 46, 92]

export function exportLocationReportPdf(data: LocationReportsData, periodLabel: string) {
  const doc = new jsPDF()
  const generatedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(18)
  doc.setTextColor(...PRIMARY_RGB)
  doc.text(`${companyInfo.shortName} — Rapport Location voiture`, 14, 18)
  doc.setFontSize(10)
  doc.setTextColor(120, 120, 120)
  doc.text(`Période : ${periodLabel}  ·  Généré le ${generatedAt}`, 14, 25)

  autoTable(doc, {
    startY: 32,
    head: [['Indicateur', 'Valeur']],
    body: [
      ['Locations réservées sur la période', data.totalBookedFormatted],
      ['Dont encaissé', data.totalCollectedInPeriodFormatted],
      ['Dépenses de la période', data.totalExpensesFormatted],
      ['Résultat net', data.netFormatted],
      ['Taux d’utilisation de la flotte', `${data.fleetUtilizationRate} %`],
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
    head: [['Top clients', 'Encaissé au total']],
    body: data.topClients.map((row) => [row.name, row.totalPaidFormatted]),
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

  doc.save(`rapport-location-voiture-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export function exportLocationReportExcel(data: LocationReportsData, periodLabel: string) {
  const workbook = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.aoa_to_sheet([
    [`Rapport Location voiture ${companyInfo.shortName}`],
    [`Période : ${periodLabel}`],
    [`Généré le ${new Date().toLocaleString('fr-FR')}`],
    [],
    ['Indicateur', 'Valeur'],
    ['Locations réservées sur la période (GNF)', data.totalBooked],
    ['Dont encaissé (GNF)', data.totalCollectedInPeriod],
    ['Dépenses de la période (GNF)', data.totalExpenses],
    ['Résultat net (GNF)', data.net],
    ['Taux d’utilisation de la flotte (%)', data.fleetUtilizationRate],
  ])
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Résumé')

  const expensesSheet = XLSX.utils.json_to_sheet(data.expensesByCategory.map((row) => ({ Catégorie: row.category, 'Montant (GNF)': row.amount })))
  XLSX.utils.book_append_sheet(workbook, expensesSheet, 'Dépenses par catégorie')

  const clientsSheet = XLSX.utils.json_to_sheet(data.topClients.map((row) => ({ Client: row.name, 'Encaissé au total (GNF)': row.totalPaid })))
  XLSX.utils.book_append_sheet(workbook, clientsSheet, 'Top clients')

  XLSX.writeFile(workbook, `rapport-location-voiture-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
