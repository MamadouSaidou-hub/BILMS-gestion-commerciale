import type { jsPDF } from 'jspdf'
import { companyInfo } from './company-info'

export const INVOICE_NAVY: [number, number, number] = [26, 60, 114]
export const INVOICE_GOLD: [number, number, number] = [201, 149, 47]
export const INVOICE_MUTED: [number, number, number] = [120, 130, 145]

export async function loadImageAsDataUrl(url: string): Promise<string | null> {
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

/**
 * Draws the logo + company block (left) and the document title + meta lines (right), sizing the
 * company name to whatever width is actually free next to the title instead of a fixed font size —
 * at a fixed size, a long title ("QUITTANCE DE LOYER", "FACTURE DE LOCATION") left just enough room
 * for "FACTURE" but ran straight into the company name's text, the two literally overlapping on
 * the rendered PDF. Returns where the header block ends so the caller's first autoTable can start
 * below it instead of a hardcoded Y that assumed a one-line, never-wrapping company name.
 */
export async function drawInvoiceHeader(doc: jsPDF, opts: { title: string; metaLines: string[] }) {
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

  doc.setFontSize(16)
  const titleWidth = doc.getTextWidth(opts.title)
  const titleLeftX = pageWidth - 14 - titleWidth
  const maxNameWidth = Math.max(titleLeftX - textX - 6, 40)

  let nameFontSize = 13
  doc.setFontSize(nameFontSize)
  let nameLines = doc.splitTextToSize(companyInfo.name, maxNameWidth) as string[]
  if (nameLines.length > 2) {
    // Still wrapping past 2 lines at the normal size — shrink once rather than let the block grow
    // tall enough to collide with the table that follows it.
    nameFontSize = 10.5
    doc.setFontSize(nameFontSize)
    nameLines = doc.splitTextToSize(companyInfo.name, maxNameWidth) as string[]
  }
  doc.setTextColor(...INVOICE_NAVY)
  nameLines.forEach((line, index) => doc.text(line, textX, 20 + index * 5))
  const afterNameY = 20 + (nameLines.length - 1) * 5

  doc.setFontSize(8.5)
  doc.setTextColor(...INVOICE_GOLD)
  doc.text(companyInfo.tagline.toUpperCase(), textX, afterNameY + 5)
  doc.setTextColor(...INVOICE_MUTED)
  doc.text(`${companyInfo.address}  ·  ${companyInfo.phone}  ·  ${companyInfo.email}`, textX, afterNameY + 10)

  doc.setFontSize(16)
  doc.setTextColor(...INVOICE_NAVY)
  doc.text(opts.title, pageWidth - 14, 20, { align: 'right' })
  doc.setFontSize(9)
  doc.setTextColor(...INVOICE_MUTED)
  opts.metaLines.forEach((line, index) => doc.text(line, pageWidth - 14, 26 + index * 5, { align: 'right' }))

  const headerBottomY = Math.max(afterNameY + 10, 26 + opts.metaLines.length * 5)
  return { pageWidth, headerBottomY }
}

/**
 * Signature + cachet, right-aligned, placed a fixed gap below whatever content came before it
 * (never a hardcoded page Y) — a short document (e.g. a one-line quittance) would otherwise leave
 * a huge dead zone between the total and a signature pinned near the bottom of the page.
 */
export async function drawSignatureAndCachet(doc: jsPDF, opts: { pageWidth: number; afterY: number }) {
  const signatureDataUrl = await loadImageAsDataUrl('/signature-cachet-bilms.png')
  if (!signatureDataUrl) return

  const signatureWidth = 45
  const signatureHeight = signatureWidth * (480 / 834)
  const signatureY = opts.afterY + 16

  try {
    doc.setFontSize(8)
    doc.setTextColor(...INVOICE_MUTED)
    doc.text('SIGNATURE ET CACHET', opts.pageWidth - 14 - signatureWidth / 2, signatureY, { align: 'center' })
    doc.addImage(signatureDataUrl, 'PNG', opts.pageWidth - 14 - signatureWidth, signatureY + 2, signatureWidth, signatureHeight)
    doc.text('Le Gérant', opts.pageWidth - 14 - signatureWidth / 2, signatureY + signatureHeight + 8, { align: 'center' })
  } catch {
    // Unreadable/unsupported image — skip the signature rather than fail the whole export.
  }
}

/**
 * Legal/registration footer, same info as the old paper invoices' footer (siège social, RCCM,
 * NIF, numéro de compte) — carried over so the generated documents are legally equivalent, not
 * just visually similar. Always pinned near the bottom of the page regardless of content length.
 */
export function drawInvoiceFooter(doc: jsPDF, pageWidth: number, firstLine: string) {
  doc.setFontSize(8.5)
  doc.setTextColor(...INVOICE_MUTED)
  doc.text(firstLine, pageWidth / 2, 278, { align: 'center' })
  doc.setFontSize(7.5)
  doc.text(`Siège social : ${companyInfo.headOffice}`, pageWidth / 2, 283, { align: 'center' })
  doc.text(`E-mail : ${companyInfo.email} · Tél : ${companyInfo.phone} / ${companyInfo.phone2}`, pageWidth / 2, 287, { align: 'center' })
  doc.text(`RCCM ${companyInfo.rccm} · Code NIF : ${companyInfo.nif} · Numéro de compte : ${companyInfo.accountNumber}`, pageWidth / 2, 291, { align: 'center' })
}
