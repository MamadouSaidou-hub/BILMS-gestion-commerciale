'use client'

import { useState } from 'react'
import { Download, Mail, MessageCircle, Printer } from 'lucide-react'
import { companyInfo } from '@/lib/company-info'

const statusLabel: Record<string, string> = { paid: 'Payée', partial: 'Partielle', unpaid: 'Non payée' }

type RentalDetail = {
  reference: string
  vehicleName: string
  vehiclePlate: string
  clientName: string
  clientPhone: string | null
  startDate: string
  plannedEndDate: string
  days: number
  dailyRateFormatted: string
  totalAmount: number
  totalAmountFormatted: string
  amountPaidFormatted: string
  paymentStatus: string
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function buildInvoicePdf(rental: RentalDetail) {
  const { jsPDF } = await import('jspdf')
  const autoTableModule = await import('jspdf-autotable')
  const autoTable = autoTableModule.default

  const NAVY: [number, number, number] = [26, 60, 114]
  const GOLD: [number, number, number] = [201, 149, 47]
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  const logoDataUrl = await loadImageAsDataUrl(companyInfo.logoPath)
  if (logoDataUrl) {
    try {
      const format = logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG'
      doc.addImage(logoDataUrl, format, 14, 14, 20, 20)
    } catch {
      // Unreadable/unsupported image — skip the logo rather than fail the whole export.
    }
  }

  const textX = logoDataUrl ? 38 : 14
  doc.setFontSize(13)
  doc.setTextColor(...NAVY)
  doc.text(companyInfo.name, textX, 20)
  doc.setFontSize(8.5)
  doc.setTextColor(...GOLD)
  doc.text(companyInfo.tagline.toUpperCase(), textX, 25)
  doc.setFontSize(8.5)
  doc.setTextColor(120, 130, 145)
  doc.text(`${companyInfo.address}  ·  ${companyInfo.phone}  ·  ${companyInfo.email}`, textX, 30)

  doc.setFontSize(16)
  doc.setTextColor(...NAVY)
  doc.text('FACTURE DE LOCATION', pageWidth - 14, 20, { align: 'right' })
  doc.setFontSize(9)
  doc.setTextColor(120, 130, 145)
  doc.text(`N° ${rental.reference}`, pageWidth - 14, 26, { align: 'right' })
  doc.text(statusLabel[rental.paymentStatus] ?? rental.paymentStatus, pageWidth - 14, 31, { align: 'right' })

  autoTable(doc, {
    startY: 44,
    body: [
      [`Véhicule\n${rental.vehicleName}\n${rental.vehiclePlate}`, `Client\n${rental.clientName}${rental.clientPhone ? `\n${rental.clientPhone}` : ''}`],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { cellWidth: (pageWidth - 28) / 2 }, 1: { cellWidth: (pageWidth - 28) / 2 } },
    margin: { left: 14, right: 14 },
  })

  const afterInfo = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4

  autoTable(doc, {
    startY: afterInfo,
    head: [['Description', 'Jours', 'Tarif/jour', 'Total']],
    body: [[`Location ${rental.vehicleName} du ${rental.startDate} au ${rental.plannedEndDate}`, String(rental.days), rental.dailyRateFormatted, rental.totalAmountFormatted]],
    theme: 'striped',
    headStyles: { fillColor: NAVY },
    styles: { fontSize: 9 },
    margin: { left: 14, right: 14 },
  })

  const afterItems = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6

  doc.setFillColor(...NAVY)
  doc.rect(pageWidth - 90, afterItems, 76, 10, 'F')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('Total à payer', pageWidth - 86, afterItems + 6.5)
  doc.text(rental.totalAmountFormatted, pageWidth - 18, afterItems + 6.5, { align: 'right' })

  doc.setFontSize(8.5)
  doc.setTextColor(120, 130, 145)
  doc.text(`Merci pour votre confiance — ${companyInfo.name}`, pageWidth / 2, 285, { align: 'center' })

  return doc
}

export function InvoiceActions({ rental }: { rental: RentalDetail }) {
  const [generating, setGenerating] = useState<'download' | 'email' | 'whatsapp' | null>(null)
  const [hint, setHint] = useState('')

  async function downloadPdf() {
    const doc = await buildInvoicePdf(rental)
    doc.save(`facture-${rental.reference}.pdf`)
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
      const message = `Facture ${rental.reference} — ${companyInfo.name}\nMontant : ${rental.totalAmountFormatted}\nMerci de votre confiance !`
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
      const subject = `Facture ${rental.reference} — ${companyInfo.name}`
      const body = `Bonjour,\n\nVeuillez trouver ci-joint la facture ${rental.reference} d'un montant de ${rental.totalAmountFormatted}.\n\nMerci de votre confiance.\n\n${companyInfo.name}\n${companyInfo.phone} · ${companyInfo.email}`
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
