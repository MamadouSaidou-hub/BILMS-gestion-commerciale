import { notFound } from 'next/navigation'
import { getLeaseContractDetail } from '@/lib/db/queries'
import { getSessionContext, isAdmin } from '@/lib/session'
import { companyInfo } from '@/lib/company-info'
import { buildLeaseContractContent } from '@/lib/lease-contract-content'
import { ContractActions } from './contract-actions'

const NAVY = '#1a3c72'
const GOLD = '#c9952f'
const MUTED = '#7d8ba0'
const BORDER = '#e3e9f1'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getSessionContext()
  if (!ctx || !isAdmin(ctx)) notFound()

  const lease = await getLeaseContractDetail(Number(id))
  if (!lease) notFound()

  const content = buildLeaseContractContent(lease)

  return (
    <div className="invoice-page">
      <div id="invoice-root" className="invoice-card">
        <div className="invoice-topbar" />

        <div className="invoice-body">
          <div className="invoice-header">
            <div className="invoice-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={companyInfo.logoPath} alt={companyInfo.name} style={{ width: 64, height: 64, objectFit: 'contain', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, letterSpacing: '-.3px' }}>{companyInfo.name}</div>
                <div style={{ fontSize: 10, color: GOLD, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', margin: '2px 0 6px' }}>{companyInfo.tagline}</div>
                <div style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.6 }}>
                  <div>{companyInfo.address}</div>
                  <div>{companyInfo.phone} · {companyInfo.email}</div>
                </div>
              </div>
            </div>
            <div className="invoice-meta">
              <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: '-.4px' }}>{content.title}</div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{content.subtitle}</div>
            </div>
          </div>

          <p style={{ fontSize: 10.5, color: '#142743', margin: '10px 0' }}>ENTRE LES SOUSSIGNÉS :</p>
          {content.parties.map((party) => (
            <div key={party.heading} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: NAVY, margin: '0 0 4px' }}>{party.heading}</p>
              {party.lines.map((line, index) => (
                <p key={index} style={{ fontSize: 10.5, color: '#384656', margin: '0 0 2px', lineHeight: 1.5 }}>{line}</p>
              ))}
            </div>
          ))}
        </div>

        <div className="invoice-items">
          {content.articles.map((article) => (
            <div key={article.title} style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: NAVY, margin: '0 0 4px' }}>{article.title}</p>
              {article.body.map((paragraph, index) => (
                <p key={index} style={{ fontSize: 10, color: '#384656', margin: '0 0 3px', lineHeight: 1.55 }}>{paragraph}</p>
              ))}
            </div>
          ))}

          <p style={{ fontSize: 10, color: MUTED, margin: '16px 0 20px' }}>
            Fait à Conakry, le {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}, en {content.signatureNames.length} exemplaires originaux.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${content.signatureLabels.length}, 1fr)`, gap: 16 }}>
            {content.signatureLabels.map((label, index) => (
              <div key={label} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, minHeight: 90 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '.06em', textTransform: 'uppercase', margin: '0 0 6px' }}>{label}</p>
                <p style={{ fontSize: 10.5, fontWeight: 600, color: '#142743', margin: 0 }}>{content.signatureNames[index]}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="invoice-footer" style={{ borderTop: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 9, color: '#b3bdcb', margin: 0 }}>Siège social : {companyInfo.headOffice}</p>
          <p style={{ fontSize: 9, color: '#b3bdcb', margin: '2px 0 0' }}>E-mail : {companyInfo.email} · Tél : {companyInfo.phone} / {companyInfo.phone2}</p>
          <p style={{ fontSize: 9, color: '#b3bdcb', margin: '2px 0 0' }}>RCCM {companyInfo.rccm} · Code NIF : {companyInfo.nif} · Numéro de compte : {companyInfo.accountNumber}</p>
        </div>
      </div>

      <div className="print-hide invoice-actions-wrap">
        <ContractActions lease={lease} />
      </div>
    </div>
  )
}
