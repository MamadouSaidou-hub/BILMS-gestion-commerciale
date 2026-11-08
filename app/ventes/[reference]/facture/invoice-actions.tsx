'use client'

import { useState } from 'react'
import { Download, Mail, MessageCircle, Printer } from 'lucide-react'
import { companyInfo } from '@/lib/company-info'
import { businessConfig } from '@/lib/business-config'
import { amountInWords } from '@/lib/number-to-words'
import { drawInvoiceFooter, drawInvoiceHeader, drawSignatureAndCachet, INVOICE_NAVY } from '@/lib/pdf-invoice'

const statusLabel: Record<string, string> = { paid: 'Payée', partial: 'Partielle', credit: 'À crédit' }

type SaleDetail = {
  reference: string
  date: string
  storeName: string
  storeCity: string
  clientName: string
  clientPhone: string | null
  paymentStatus: string
  totalAmount: number
  totalAmountFormatted: string
  items: { productName: string; sku: string; quantity: number; unitPriceFormatted: string; lineTotalFormatted: string }[]
  receivable: { amountFormatted: string; dueDate: string } | null
}

async function buildInvoicePdf(sale: SaleDetail) {
  const { jsPDF } = await import('jspdf')
  const autoTableModule = await import('jspdf-autotable')
  const autoTable = autoTableModule.default

  const doc = new jsPDF()

  const { pageWidth, headerBottomY } = await drawInvoiceHeader(doc, {
    title: 'FACTURE',
    metaLines: [
      `N° ${sale.reference}`,
      new Date(sale.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
      statusLabel[sale.paymentStatus] ?? sale.paymentStatus,
    ],
  })

  autoTable(doc, {
    startY: Math.max(44, headerBottomY + 8),
    body: [
      [`Magasin\n${sale.storeName}\n${sale.storeCity}`, `Facturé à\n${sale.clientName}${sale.clientPhone ? `\n${sale.clientPhone}` : ''}`],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: (pageWidth - 28) / 2 }, 1: { cellWidth: (pageWidth - 28) / 2 } },
    margin: { left: 14, right: 14 },
  })

  const afterInfo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  autoTable(doc, {
    startY: afterInfo,
    head: [['Article', 'Qté', 'P.U.', 'Total']],
    body: sale.items.map((item) => [`${item.productName} (${item.sku})`, String(item.quantity), item.unitPriceFormatted, item.lineTotalFormatted]),
    theme: 'striped',
    headStyles: { fillColor: INVOICE_NAVY },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  })

  const afterItems = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6

  doc.setFillColor(...INVOICE_NAVY)
  doc.rect(pageWidth - 90, afterItems, 76, 10, 'F')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('Total à payer', pageWidth - 86, afterItems + 6.5)
  doc.text(sale.totalAmountFormatted, pageWidth - 18, afterItems + 6.5, { align: 'right' })

  let afterTotal = afterItems + 14
  if (sale.receivable) {
    doc.setFontSize(9)
    doc.setTextColor(193, 120, 0)
    doc.text(
      `Solde dû (échéance ${new Date(sale.receivable.dueDate).toLocaleDateString('fr-FR')}) : ${sale.receivable.amountFormatted}`,
      pageWidth - 18,
      afterTotal,
      { align: 'right' },
    )
    afterTotal += 6
  }

  doc.setFontSize(9)
  doc.setTextColor(90, 107, 130)
  doc.text('Arrêtée la présente facture à la somme de :', 14, afterTotal + 4)
  doc.setFont('helvetica', 'italic')
  doc.text(`${amountInWords(sale.totalAmount)} ${businessConfig.currency}`, 14, afterTotal + 9)
  doc.setFont('helvetica', 'normal')

  await drawSignatureAndCachet(doc, { pageWidth, afterY: afterTotal })

  drawInvoiceFooter(doc, pageWidth, `Merci pour votre confiance — ${companyInfo.name}`)

  return doc
}

export function InvoiceActions({ sale }: { sale: SaleDetail }) {
  const [generating, setGenerating] = useState<'download' | 'email' | 'whatsapp' | null>(null)
  const [hint, setHint] = useState('')

  async function downloadPdf() {
    const doc = await buildInvoicePdf(sale)
    doc.save(`facture-${sale.reference}.pdf`)
  }

  async function handleDownload() {
    setGenerating('download')
    try {
      await downloadPdf()
    } finally {
      setGenerating(null)
    }
  }

  async function handleShareWhatsapp() {
    setGenerating('whatsapp')
    try {
      await downloadPdf()
      setHint('PDF téléchargé — joignez-le manuellement dans la conversation WhatsApp qui vient de s’ouvrir.')
      const message = `Facture ${sale.reference} — ${companyInfo.name}\nMontant : ${sale.totalAmountFormatted}\nMerci de votre confiance !`
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
    } finally {
      setGenerating(null)
    }
  }

  async function handleShareEmail() {
    setGenerating('email')
    try {
      await downloadPdf()
      setHint('PDF téléchargé — joignez-le manuellement au brouillon e-mail qui vient de s’ouvrir.')
      const subject = `Facture ${sale.reference} — ${companyInfo.name}`
      const body = `Bonjour,\n\nVeuillez trouver ci-joint la facture ${sale.reference} d'un montant de ${sale.totalAmountFormatted}.\n\nMerci de votre confiance.\n\n${companyInfo.name}\n${companyInfo.phone} · ${companyInfo.email}`
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="invoice-actions-inner">
      {hint && <p style={{ fontSize: 10, color: 'var(--faint)', margin: 0, maxWidth: 320 }}>{hint}</p>}
      <div className="invoice-actions-buttons">
        <button type="button" className="btn-secondary" disabled={generating !== null} onClick={handleShareEmail}>
          <Mail size={13} /> {generating === 'email' ? 'Préparation...' : 'E-mail'}
        </button>
        <button type="button" className="btn-secondary" disabled={generating !== null} onClick={handleShareWhatsapp}>
          <MessageCircle size={13} /> {generating === 'whatsapp' ? 'Préparation...' : 'WhatsApp'}
        </button>
        <button type="button" className="btn-secondary" disabled={generating !== null} onClick={handleDownload}>
          <Download size={13} /> {generating === 'download' ? 'Génération...' : 'Télécharger PDF'}
        </button>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          <Printer size={13} /> Imprimer
        </button>
      </div>
    </div>
  )
}
