import { companyInfo } from './company-info'

export type LeaseContractDetail = {
  id: number
  startDate: string
  endDate: string
  durationMonths: number
  noticeMonths: number
  latePenaltyPct: number
  monthlyRent: number
  monthlyRentFormatted: string
  depositAmount: number
  depositAmountFormatted: string
  tenant: {
    name: string
    phone: string | null
    email: string | null
    profession: string | null
    birthDate: string | null
    birthPlace: string | null
    nationality: string | null
    cin: string | null
    cinValidUntil: string | null
  }
  guarantor: {
    name: string | null
    phone: string | null
    email: string | null
    residence: string | null
    nationality: string | null
    cin: string | null
    cinValidUntil: string | null
  }
  unit: { label: string; floor: number; description: string | null }
  building: { name: string; address: string; servicesIncluded: string | null }
}

function formatDateFr(dateStr: string | null) {
  if (!dateStr) return '____________________'
  const date = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function blank(value: string | null | undefined, fallback = '____________________') {
  return value && value.trim() ? value : fallback
}

const durationWords: Record<number, string> = { 1: 'un (01) an', 2: 'deux (02) ans', 3: 'trois (03) ans' }
function monthsToYearsLabel(months: number) {
  if (months % 12 === 0) {
    const years = months / 12
    return durationWords[years] ?? `${years} ans`
  }
  return `${months} mois`
}
const monthsLabel: Record<number, string> = { 1: 'un (01) mois', 2: 'deux (02) mois', 3: 'trois (03) mois' }

export function buildLeaseContractContent(lease: LeaseContractDetail) {
  const floorLabel = lease.unit.floor === 0 ? 'rez-de-chaussée' : `${lease.unit.floor}${lease.unit.floor === 1 ? 'er' : 'ème'} étage`
  const hasGuarantor = Boolean(lease.guarantor.name)

  const parties = [
    {
      heading: '1. LE BAILLEUR :',
      lines: [
        `${companyInfo.displayName}, dont le siège est à ${companyInfo.headOffice}.`,
        `Téléphone : ${companyInfo.phone} / ${companyInfo.phone2}`,
        `Email : ${companyInfo.email}`,
      ],
    },
    {
      heading: '2. LE LOCATAIRE :',
      lines: [
        `${lease.tenant.name}${lease.tenant.profession ? `, ${lease.tenant.profession}` : ''}${
          lease.tenant.birthDate ? `, né(e) le ${formatDateFr(lease.tenant.birthDate)}${lease.tenant.birthPlace ? ` à ${lease.tenant.birthPlace}` : ''}` : ''
        }, de nationalité ${blank(lease.tenant.nationality, 'guinéenne')}, titulaire de la CIN n°${blank(lease.tenant.cin)} valable jusqu’au ${formatDateFr(lease.tenant.cinValidUntil)}.`,
        `Téléphone : ${blank(lease.tenant.phone)}`,
        `Email : ${blank(lease.tenant.email)}`,
      ],
    },
    hasGuarantor
      ? {
          heading: '3. LE GARANT (CAUTION SOLIDAIRE) :',
          lines: [
            `${lease.guarantor.name}, résident à ${blank(lease.guarantor.residence)}, de nationalité ${blank(lease.guarantor.nationality, 'guinéenne')}, CIN n°${blank(lease.guarantor.cin)}, valable jusqu’au ${formatDateFr(lease.guarantor.cinValidUntil)}.`,
            `Téléphone : ${blank(lease.guarantor.phone)}`,
            `Email : ${blank(lease.guarantor.email)}`,
          ],
        }
      : null,
  ].filter((p): p is { heading: string; lines: string[] } => p !== null)

  const articles: { title: string; body: string[] }[] = [
    {
      title: 'ARTICLE 1 : OBJET ET DÉSIGNATION DU BIEN',
      body: [
        `Le Bailleur donne en location au Locataire le logement ${lease.unit.label} situé au ${floorLabel} de ${lease.building.name}, ${lease.building.address}.`,
        ...(lease.unit.description ? [lease.unit.description] : []),
      ],
    },
    {
      title: 'ARTICLE 2 : DURÉE ET PRÉAVIS',
      body: [
        `Le présent bail est conclu pour une durée de ${monthsToYearsLabel(lease.durationMonths)} à compter du ${formatDateFr(lease.startDate)}, renouvelable par tacite reconduction.`,
        `Congé : Chaque partie peut mettre fin au contrat moyennant un préavis de ${monthsLabel[lease.noticeMonths] ?? `${lease.noticeMonths} mois`} notifié par écrit.`,
      ],
    },
    {
      title: 'ARTICLE 3 : CONDITIONS FINANCIÈRES',
      body: [
        `Loyer mensuel : Fixé à ${lease.monthlyRentFormatted}. Il est payable d’avance au plus tard le 05 de chaque mois.`,
        `Pénalités de retard : Passé le 10 du mois, une pénalité de retard de ${lease.latePenaltyPct}% s’applique de plein droit sur le montant du loyer dû.`,
        lease.depositAmount > 0
          ? `Dépôt de garantie (Caution) : Le Locataire verse la somme de ${lease.depositAmountFormatted}. Elle sera restituée dans un délai maximum d’un mois après la remise des clés, déduction faite des éventuelles dégradations constatées lors de l’état des lieux de sortie.`
          : 'Dépôt de garantie (Caution) : Aucune caution n’est exigée pour ce bail.',
      ],
    },
    {
      title: 'ARTICLE 4 : ÉTAT DES LIEUX',
      body: ['Un état des lieux contradictoire sera établi à la remise des clés et à la restitution des locaux. À défaut, le locataire est présumé avoir reçu les lieux en parfait état.'],
    },
    {
      title: 'ARTICLE 5 : CHARGES ET SERVICES',
      body: [
        'Électricité : Système prépayé à la charge exclusive du Locataire.',
        'Eau : Usage responsable de l’eau de forage. Le Bailleur assure la disponibilité technique de la ressource.',
        ...(lease.building.servicesIncluded ? [`Services inclus : ${lease.building.servicesIncluded}.`] : []),
      ],
    },
    {
      title: 'ARTICLE 6 : OBLIGATIONS ET RÈGLEMENT INTÉRIEUR',
      body: [
        'Usage : Habitation exclusivement. Le respect du voisinage est impératif.',
        'Entretien : Le Locataire assure l’entretien courant. Les grosses réparations (toiture, structure) et les réseaux principaux (eau, électricité, assainissement) incombent au Bailleur.',
        'Interdictions : Usage de charbon de bois, lavage de voitures dans la cour, et étendage de linge sur les garde-corps des balcons sont formellement interdits.',
        'Transformations : Aucune modification de la distribution des pièces ou travaux importants ne peut être faite sans l’accord écrit du Bailleur.',
      ],
    },
    {
      title: 'ARTICLE 7 : DROIT D’ACCÈS POUR TRAVAUX OU CONTRÔLE',
      body: ['Le locataire doit permettre l’accès au logement pour travaux nécessaires ou contrôles techniques, après information préalable.'],
    },
    {
      title: 'ARTICLE 8 : HYGIÈNE ET SALUBRITÉ',
      body: ['Le locataire doit maintenir le logement en bon état d’hygiène et respecter les règles de salubrité, notamment en matière de déchets, d’eau et d’assainissement.'],
    },
    {
      title: 'ARTICLE 9 : SÉCURITÉ ET RISQUES',
      body: ['Le locataire s’engage à ne pas utiliser d’équipements ou pratiques susceptibles de compromettre la sécurité du bâtiment (feu, installations dangereuses, surcharge électrique).'],
    },
    {
      title: 'ARTICLE 10 : CLAUSE RÉSOLUTOIRE',
      body: ['À défaut de paiement d’un seul terme de loyer à son échéance ou en cas d’inexécution d’une clause du contrat, le bail sera résilié de plein droit après une mise en demeure restée infructueuse pendant 15 jours.'],
    },
    {
      title: 'ARTICLE 11 : CADRE JURIDIQUE ET LITIGES',
      body: [
        'Le présent contrat est régi par les dispositions légales et réglementaires en vigueur en République de Guinée, notamment le Code de l’habitat et de la construction.',
        'Les parties s’engagent à privilégier un règlement amiable de tout différend relatif à l’interprétation ou à l’exécution du présent contrat.',
        'À défaut d’accord amiable, le litige sera porté devant les juridictions compétentes à Conakry, République de Guinée.',
      ],
    },
  ]

  return {
    title: 'CONTRAT DE BAIL À USAGE D’HABITATION',
    subtitle: `${lease.building.name} — Conakry, République de Guinée`,
    parties,
    articles,
    signatureLabels: hasGuarantor ? ['LE BAILLEUR', 'LE LOCATAIRE', 'LE GARANT'] : ['LE BAILLEUR', 'LE LOCATAIRE'],
    signatureNames: hasGuarantor
      ? [companyInfo.displayName, lease.tenant.name, lease.guarantor.name ?? '']
      : [companyInfo.displayName, lease.tenant.name],
  }
}
