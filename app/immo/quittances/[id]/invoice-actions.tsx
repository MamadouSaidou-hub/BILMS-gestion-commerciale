'use client'

import { useState } from 'react'
import { Download, Mail, MessageCircle, Printer } from 'lucide-react'
import { companyInfo } from '@/lib/company-info'
import { businessConfig } from '@/lib/business-config'
import { amountInWords } from '@/lib/number-to-words'
import { drawInvoiceHeader, drawSignatureAndCachet, INVOICE_NAVY } from '@/lib/pdf-invoice'

type PaymentDetail = {
  reference: string
  period: string
  amount: number
  amountFormatted: string
  tenantName: string
  tenantPhone: string | null
  unitLabel: string
  buildingName: string
  buildingAddress: string
}

async function buildReceiptPdf(payment: PaymentDetail) {
  const { jsPDF } = await import('jspdf')
  const autoTableModule = await import('jspdf-autotable')
  const autoTable = autoTableModule.default

  const doc = new jsPDF()

  const { pageWidth, headerBottomY } = await drawInvoiceHeader(doc, {
    title: 'QUITTANCE DE LOYER',
    metaLines: [`N° ${payment.reference}`, `Période : ${payment.period}`],
  })

  autoTable(doc, {
    startY: Math.max(44, headerBottomY + 8),
    body: [
      [`Logement\n${payment.buildingName} — ${payment.unitLabel}\n${payment.buildingAddress}`, `Locataire\n${payment.tenantName}${payment.tenantPhone ? `\n${payment.tenantPhone}` : ''}`],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: (pageWidth - 28) / 2 }, 1: { cellWidth: (pageWidth - 28) / 2 } },
    margin: { left: 14, right: 14 },
  })

  const afterInfo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  autoTable(doc, {
    startY: afterInfo,
    head: [['Description', 'Montant']],
    body: [[`Loyer — ${payment.unitLabel} — ${payment.period}`, payment.amountFormatted]],
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
  doc.text('Total payé', pageWidth - 86, afterItems + 6.5)
  doc.text(payment.amountFormatted, pageWidth - 18, afterItems + 6.5, { align: 'right' })

  const afterTotal = afterItems + 14
  doc.setFontSize(9)
  doc.setTextColor(90, 107, 130)
  doc.text('Arrêtée la présente quittance à la somme de :', 14, afterTotal + 4)
  doc.setFont('helvetica', 'italic')
  doc.text(`${amountInWords(payment.amount)} ${businessConfig.currency}`, 14, afterTotal + 9)
  doc.setFont('helvetica', 'normal')

  await drawSignatureAndCachet(doc, { pageWidth, afterY: afterTotal })

  doc.setFontSize(8.5)
  doc.setTextColor(120, 130, 145)
  doc.text(`Reçu pour valoir ce que de droit — ${companyInfo.name}`, pageWidth / 2, 285, { align: 'center' })

  return doc
}

export function InvoiceActions({ payment }: { payment: PaymentDetail }) {
  const [generating, setGenerating] = useState<'download' | 'email' | 'whatsapp' | null>(null)
  const [hint, setHint] = useState('')

  async function downloadPdf() {
    const doc = await buildReceiptPdf(payment)
    doc.save(`quittance-${payment.reference}.pdf`)
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
      const message = `Quittance ${payment.reference} — ${companyInfo.name}\nMontant : ${payment.amountFormatted}\nMerci !`
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
      const subject = `Quittance ${payment.reference} — ${companyInfo.name}`
      const body = `Bonjour,\n\nVeuillez trouver ci-joint la quittance ${payment.reference} d'un montant de ${payment.amountFormatted}.\n\n${companyInfo.name}\n${companyInfo.phone} · ${companyInfo.email}`
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
