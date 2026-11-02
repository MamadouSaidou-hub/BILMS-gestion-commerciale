import { notFound } from 'next/navigation'
import { getRentalDetail } from '@/lib/db/queries'
import { getSessionContext, isAdmin } from '@/lib/session'
import { companyInfo } from '@/lib/company-info'
import { InvoiceActions } from './invoice-actions'

const statusLabel = { paid: 'Payée', partial: 'Partielle', unpaid: 'Non payée' }
const statusColor = { paid: '#2e9e3f', partial: '#f0a020', unpaid: '#d1453d' }

const NAVY = '#1a3c72'
const GOLD = '#c9952f'
const MUTED = '#7d8ba0'
const BORDER = '#e3e9f1'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getSessionContext()
  if (!ctx || !isAdmin(ctx)) notFound()

  const rental = await getRentalDetail(Number(id))
  if (!rental) notFound()

  const status = rental.paymentStatus as keyof typeof statusLabel

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
              <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, letterSpacing: '-.5px' }}>FACTURE DE LOCATION</div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>N° {rental.reference}</div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                {new Date(rental.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </div>
              <span style={{ display: 'inline-block', marginTop: 8, fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 12, color: statusColor[status], background: `${statusColor[status]}1a` }}>
                {statusLabel[status]}
              </span>
            </div>
          </div>

          <div className="invoice-parties">
            <div className="invoice-party">
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>Véhicule</p>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{rental.vehicleName}</p>
              <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>{rental.vehiclePlate}</p>
            </div>
            <div className="invoice-party">
              <p style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: '.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>Client</p>
              <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0 }}>{rental.clientName}</p>
              {rental.clientPhone && <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>{rental.clientPhone}</p>}
            </div>
          </div>
        </div>

        <div className="invoice-items">
          <div className="invoice-table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 6px', fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '10px 6px', fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Jours</th>
                  <th style={{ textAlign: 'right', padding: '10px 6px', fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tarif/jour</th>
                  <th style={{ textAlign: 'right', padding: '10px 6px', fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '10px 6px' }}>Location {rental.vehicleName} du {rental.startDate} au {rental.plannedEndDate}</td>
                  <td style={{ textAlign: 'right', padding: '10px 6px' }}>{rental.days}</td>
                  <td style={{ textAlign: 'right', padding: '10px 6px' }}>{rental.dailyRateFormatted}</td>
                  <td style={{ textAlign: 'right', padding: '10px 6px', fontWeight: 600 }}>{rental.totalAmountFormatted}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="invoice-totals-row">
            <div style={{ minWidth: 240 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: NAVY, borderRadius: 8, color: 'white', fontWeight: 800, fontSize: 14 }}>
                <span>Total à payer</span><span>{rental.totalAmountFormatted}</span>
              </div>
              {rental.paymentStatus !== 'paid' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px 0', fontSize: 11, color: '#c17800', fontWeight: 700 }}>
                  <span>Déjà payé</span>
                  <span>{rental.amountPaidFormatted}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="invoice-footer" style={{ borderTop: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 11, color: MUTED, margin: 0 }}>Merci pour votre confiance — {companyInfo.name}</p>
          <p style={{ fontSize: 9.5, color: '#b3bdcb', margin: '4px 0 0' }}>{companyInfo.address} · {companyInfo.phone} · {companyInfo.email}</p>
        </div>
      </div>

      <div className="print-hide invoice-actions-wrap">
        <InvoiceActions rental={rental} />
      </div>
    </div>
  )
}
