'use client'

import { useState } from 'react'
import { Download, Mail, MessageCircle, Printer } from 'lucide-react'
import { companyInfo } from '@/lib/company-info'
import { buildLeaseContractContent, type LeaseContractDetail } from '@/lib/lease-contract-content'
import { drawInvoiceFooter, drawInvoiceHeader, INVOICE_MUTED, INVOICE_NAVY } from '@/lib/pdf-invoice'

const LEFT = 14
const PAGE_BOTTOM = 268 // leaves room for drawInvoiceFooter, which starts at y=278

async function buildContractPdf(lease: LeaseContractDetail) {
  const { jsPDF } = await import('jspdf')
  const content = buildLeaseContractContent(lease)
  const doc = new jsPDF()
  const footerFirstLine = `${content.title} — ${companyInfo.name}`

  const { pageWidth, headerBottomY } = await drawInvoiceHeader(doc, { title: 'CONTRAT DE BAIL', metaLines: [content.subtitle] })
  const maxWidth = pageWidth - LEFT * 2
  let y = Math.max(44, headerBottomY + 8)

  function newPage() {
    drawInvoiceFooter(doc, pageWidth, footerFirstLine)
    doc.addPage()
    y = 20
  }

  function ensureSpace(linesNeeded: number) {
    const needed = linesNeeded * 4.6 + 6
    if (y + needed > PAGE_BOTTOM) newPage()
  }

  function writeHeading(text: string) {
    doc.setFontSize(10.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...INVOICE_NAVY)
    ensureSpace(1)
    doc.text(text, LEFT, y)
    y += 6
    doc.setFont('helvetica', 'normal')
  }

  function writeParagraph(text: string) {
    doc.setFontSize(9.5)
    doc.setTextColor(60, 70, 86)
    const lines = doc.splitTextToSize(text, maxWidth) as string[]
    ensureSpace(lines.length)
    doc.text(lines, LEFT, y)
    y += lines.length * 4.6 + 2
  }

  doc.setFontSize(9.5)
  doc.setTextColor(20, 39, 67)
  doc.text('ENTRE LES SOUSSIGNÉS :', LEFT, y)
  y += 7

  for (const party of content.parties) {
    writeHeading(party.heading)
    party.lines.forEach(writeParagraph)
    y += 2
  }

  for (const article of content.articles) {
    writeHeading(article.title)
    article.body.forEach(writeParagraph)
    y += 2
  }

  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  ensureSpace(2)
  doc.setFontSize(9)
  doc.setTextColor(...INVOICE_MUTED)
  doc.text(`Fait à Conakry, le ${today}, en ${content.signatureNames.length} exemplaires originaux.`, LEFT, y)
  y += 14

  const boxWidth = (maxWidth - (content.signatureLabels.length - 1) * 6) / content.signatureLabels.length
  const boxHeight = 28
  ensureSpace(Math.ceil(boxHeight / 4.6) + 2)
  content.signatureLabels.forEach((label, index) => {
    const x = LEFT + index * (boxWidth + 6)
    doc.setDrawColor(227, 233, 241)
    doc.rect(x, y, boxWidth, boxHeight)
    doc.setFontSize(7.5)
    doc.setTextColor(...INVOICE_MUTED)
    doc.text(label, x + 4, y + 7)
    doc.setFontSize(9)
    doc.setTextColor(20, 39, 67)
    const nameLines = doc.splitTextToSize(content.signatureNames[index] || '', boxWidth - 8) as string[]
    doc.text(nameLines, x + 4, y + 14)
  })

  drawInvoiceFooter(doc, pageWidth, footerFirstLine)

  return doc
}

export function ContractActions({ lease }: { lease: LeaseContractDetail }) {
  const [generating, setGenerating] = useState<'download' | 'email' | 'whatsapp' | null>(null)
  const [hint, setHint] = useState('')

  async function downloadPdf() {
    const doc = await buildContractPdf(lease)
    doc.save(`contrat-bail-${lease.tenant.name.replace(/\s+/g, '-').toLowerCase()}.pdf`)
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
      const message = `Contrat de bail — ${lease.tenant.name} — ${companyInfo.name}`
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
      const subject = `Contrat de bail — ${lease.tenant.name} — ${companyInfo.name}`
      const body = `Bonjour,\n\nVeuillez trouver ci-joint le contrat de bail.\n\n${companyInfo.name}\n${companyInfo.phone} · ${companyInfo.email}`
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
