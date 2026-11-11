import { describe, expect, it } from 'vitest'
import { buildLeaseContractContent, type LeaseContractDetail } from '@/lib/lease-contract-content'

function baseLease(overrides: Partial<LeaseContractDetail> = {}): LeaseContractDetail {
  return {
    id: 1,
    startDate: '2026-11-01',
    endDate: '2027-11-01',
    durationMonths: 12,
    noticeMonths: 3,
    latePenaltyPct: 10,
    monthlyRent: 5_000_000,
    monthlyRentFormatted: '5 000 000 GNF',
    depositAmount: 10_000_000,
    depositAmountFormatted: '10 000 000 GNF',
    tenant: { name: 'Thierno Barry', phone: '621364697', email: null, profession: 'Gestionnaire', birthDate: '1978-10-03', birthPlace: 'Pita', nationality: 'guinéenne', cin: 'CIN-1', cinValidUntil: '2026-08-09' },
    guarantor: { name: null, phone: null, email: null, residence: null, nationality: null, cin: null, cinValidUntil: null },
    unit: { label: 'Appartement B2', floor: 2, description: 'Deux chambres, un salon' },
    building: { name: 'Résidence BIMCO', address: 'Conakry', servicesIncluded: 'Parking, gardiennage' },
    ...overrides,
  }
}

describe('buildLeaseContractContent', () => {
  it('omits the guarantor party and signature box entirely when there is none', () => {
    const content = buildLeaseContractContent(baseLease())
    expect(content.parties).toHaveLength(2)
    expect(content.parties.some((p) => p.heading.includes('GARANT'))).toBe(false)
    expect(content.signatureLabels).toEqual(['LE BAILLEUR', 'LE LOCATAIRE'])
  })

  it('includes the guarantor as a third party and signature box when one is set', () => {
    const content = buildLeaseContractContent(
      baseLease({ guarantor: { name: 'Souleymane Diallo', phone: '622238070', email: null, residence: 'Kipé', nationality: 'Guinéenne', cin: null, cinValidUntil: null } }),
    )
    expect(content.parties).toHaveLength(3)
    expect(content.parties[2].heading).toContain('GARANT')
    expect(content.signatureLabels).toEqual(['LE BAILLEUR', 'LE LOCATAIRE', 'LE GARANT'])
    expect(content.signatureNames[2]).toBe('Souleymane Diallo')
  })

  it('reflects the lease\'s own duration/notice/penalty instead of hardcoding the sample contract\'s values', () => {
    const content = buildLeaseContractContent(baseLease({ durationMonths: 24, noticeMonths: 1, latePenaltyPct: 5 }))
    const article2 = content.articles.find((a) => a.title.includes('ARTICLE 2'))!
    const article3 = content.articles.find((a) => a.title.includes('ARTICLE 3'))!
    expect(article2.body.join(' ')).toContain('deux (02) ans')
    expect(article2.body.join(' ')).toContain('un (01) mois')
    expect(article3.body.join(' ')).toContain('5%')
  })

  it('states no deposit is required when depositAmount is 0', () => {
    const content = buildLeaseContractContent(baseLease({ depositAmount: 0 }))
    const article3 = content.articles.find((a) => a.title.includes('ARTICLE 3'))!
    expect(article3.body.join(' ')).toMatch(/aucune caution/i)
  })

  it('includes the unit description and building services when present, omits them when absent', () => {
    const withExtras = buildLeaseContractContent(baseLease())
    const article1 = withExtras.articles.find((a) => a.title.includes('ARTICLE 1'))!
    const article5 = withExtras.articles.find((a) => a.title.includes('ARTICLE 5'))!
    expect(article1.body).toContain('Deux chambres, un salon')
    expect(article5.body.join(' ')).toContain('Parking, gardiennage')

    const withoutExtras = buildLeaseContractContent(baseLease({ unit: { label: 'Appt', floor: 1, description: null }, building: { name: 'B', address: 'A', servicesIncluded: null } }))
    const article1b = withoutExtras.articles.find((a) => a.title.includes('ARTICLE 1'))!
    expect(article1b.body).toHaveLength(1)
  })
})
