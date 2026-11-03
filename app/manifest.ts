import type { MetadataRoute } from 'next'
import { companyInfo } from '@/lib/company-info'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${companyInfo.shortName} — Gestion`,
    short_name: companyInfo.shortName,
    description: 'Pilotez vos magasins, vos ventes et votre trésorerie depuis un seul espace.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f9fc',
    theme_color: '#f7f9fc',
    orientation: 'portrait',
    icons: [
      { src: '/logo-bilms-mark.png', sizes: '192x192', type: 'image/png' },
      { src: '/logo-bilms-mark.png', sizes: '512x512', type: 'image/png' },
      { src: '/logo-bilms-mark.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
