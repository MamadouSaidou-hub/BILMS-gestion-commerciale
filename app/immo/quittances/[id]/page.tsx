import { notFound } from 'next/navigation'
import { getRentPaymentDetail } from '@/lib/db/queries'
import { getSessionContext, isAdmin } from '@/lib/session'
import { companyInfo } from '@/lib/company-info'
import { InvoiceActions } from './invoice-actions'

const NAVY = '#1a3c72'
const GOLD = '#c9952f'
const MUTED = '#7d8ba0'
const BORDER = '#e3e9f1'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getSessionContext()
  if (!ctx || !isAdmin(ctx)) notFound()

  const payment = await getRentPaymentDetail(Number(id))
  if (!payment) notFound()

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
              <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, letterSpacing: '-.5px' }}>QUITTANCE DE LOYER</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>N° {payment.reference}</div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>Période : {payment.period}</div>
              <span style={{ display: 'inline-block', marginTop: 8, fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 12, color: '#2e9e3f', background: '#2e9e3f1a' }}>Payé</span>
            </div>
          </div>

          <div className="invoice-parties">
            <div className="invoice-party">
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>Logement</p>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{payment.buildingName} — {payment.unitLabel}</p>
              <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>{payment.buildingAddress}</p>
            </div>
            <div className="invoice-party">
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>Locataire</p>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{payment.tenantName}</p>
              {payment.tenantPhone && <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>{payment.tenantPhone}</p>}
            </div>
          </div>
        </div>

        <div className="invoice-items">
          <div className="invoice-table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 6px', fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '10px 6px', fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Montant</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '10px 6px' }}>Loyer — {payment.unitLabel} — {payment.period}</td>
                  <td style={{ textAlign: 'right', padding: '10px 6px', fontWeight: 600 }}>{payment.amountFormatted}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="invoice-totals-row">
            <div style={{ minWidth: 240 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: NAVY, borderRadius: 8, color: 'white', fontWeight: 800, fontSize: 14 }}>
                <span>Total payé</span><span>{payment.amountFormatted}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="invoice-footer" style={{ borderTop: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>Reçu pour valoir ce que de droit — {companyInfo.name}</p>
          <p style={{ fontSize: 9.5, color: '#b3bdcb', margin: '4px 0 0' }}>{companyInfo.address} · {companyInfo.phone} · {companyInfo.email}</p>
        </div>
      </div>

      <div className="print-hide invoice-actions-wrap">
        <InvoiceActions payment={payment} />
      </div>
    </div>
  )
}
