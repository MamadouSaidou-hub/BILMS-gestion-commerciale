'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import {
  ArrowLeftRight,
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Search,
  ShoppingCart,
  Store,
  Truck,
  UserCog,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { AppearanceMenu } from '@/components/appearance-menu'
import { NotificationMenu } from '@/components/notification-menu'
import { companyInfo } from '@/lib/company-info'

// Three collapsible sidebar groups: "Boutique" holds everything the app already did (sales/stock/
// etc. — the former "PILOTAGE"/"GESTION" captions merged into one), "Immo" and "Location voiture"
// are the two new business lines, admin-only like the sensitive existing sections (Fournisseurs,
// Trésorerie).
const navGroups = [
  {
    key: 'boutique',
    label: 'Boutique',
    icon: Store,
    items: [
      { href: '/', label: 'Tableau de bord', icon: LayoutDashboard, adminOnly: false },
      { href: '/ventes', label: 'Ventes', icon: ShoppingCart, adminOnly: false },
      { href: '/stock', label: 'Stock', icon: Package, adminOnly: false },
      { href: '/transferts', label: 'Transferts', icon: ArrowLeftRight, adminOnly: false },
      { href: '/tresorerie', label: 'Trésorerie', icon: WalletCards, adminOnly: true },
      { href: '/magasins', label: 'Magasins', icon: Store, adminOnly: true },
      { href: '/clients', label: 'Clients & créances', icon: Users, adminOnly: false },
      { href: '/fournisseurs', label: 'Fournisseurs', icon: Truck, adminOnly: true },
      { href: '/rapports', label: 'Rapports', icon: ReceiptText, adminOnly: true },
      { href: '/utilisateurs', label: 'Utilisateurs', icon: UserCog, adminOnly: true },
    ],
  },
  {
    key: 'immo',
    label: 'Immo',
    icon: Building2,
    items: [{ href: '/immo', label: 'Immeubles', icon: Building2, adminOnly: true }],
  },
  {
    key: 'location',
    label: 'Location voiture',
    icon: Car,
    items: [{ href: '/location-voiture', label: 'Véhicules', icon: Car, adminOnly: true }],
  },
]

function UserChip() {
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [open, setOpen] = useState(false)

  const name = session?.user?.name ?? '…'
  const role = session?.user?.role ?? 'gestionnaire'
  const roleLabel = role === 'admin' ? 'Administrateur' : 'Gestionnaire'
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  async function handleLogout() {
    await authClient.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="user-chip"
        style={{ border: 0, background: 'none', width: '100%', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
        onClick={() => setOpen((value) => !value)}
      >
        <div className="avatar">{initials || '…'}</div>
        <div><strong>{name}</strong><span>{roleLabel}</span></div>
        <ChevronDown />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            marginBottom: 6,
            overflow: 'hidden',
            boxShadow: '0 4px 14px rgba(16,25,41,.25)',
          }}
        >
          <button
            type="button"
            className="nav-link"
            style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
            onClick={handleLogout}
          >
            <LogOut />Se déconnecter
          </button>
        </div>
      )}
    </div>
  )
}

export function AppShell({
  breadcrumb,
  section,
  children,
  onExport,
}: {
  breadcrumb: string
  section: string
  children: ReactNode
  onExport?: () => void
}) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { data: session } = authClient.useSession()
  const isAdmin = session?.user?.role === 'admin'

  // Each group starts expanded if it contains the current page (so a refresh on /immo doesn't
  // hide the link you're already on), with "Boutique" additionally open by default since it's the
  // main/most-used section.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navGroups.map((group) => [group.key, group.key === 'boutique' || group.items.some((item) => item.href === pathname)])),
  )
  const toggleGroup = (key: string) => setOpenGroups((groups) => ({ ...groups, [key]: !groups[key] }))

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={companyInfo.logoPath} alt={companyInfo.shortName} className="brand-mark" />
          <div><strong>{companyInfo.shortName}</strong><span>{companyInfo.displayName}</span></div>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu"><X /></button>
        </div>
        <div className="workspace-select"><span className="workspace-dot" /><span>Direction générale</span><ChevronDown aria-hidden="true" /></div>
        <nav className="nav-list" aria-label="Navigation principale">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter((item) => isAdmin || !item.adminOnly)
            if (visibleItems.length === 0) return null
            const open = openGroups[group.key]
            return (
              <div key={group.key}>
                <button
                  type="button"
                  className="nav-group-toggle"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={open}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 0, background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left', padding: '10px 12px', color: 'var(--text)' }}
                >
                  <group.icon size={15} />
                  <span style={{ flex: 1, fontWeight: 600 }}>{group.label}</span>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {open && visibleItems.map((item) => (
                  <Link key={item.href} className={`nav-link ${pathname === item.href ? 'active' : ''}`} href={item.href} style={{ paddingLeft: 30 }}>
                    <item.icon />{item.label}
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <UserChip />
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu /></button>
          <div className="breadcrumb"><span>{breadcrumb}</span><strong>{section}</strong></div>
          <div className="topbar-actions">
            <AppearanceMenu variant="topbar" />
            {searchOpen && <input className="search-input" autoFocus placeholder="Rechercher..." aria-label="Rechercher" />}
            <button className="icon-button" onClick={() => setSearchOpen(!searchOpen)} aria-label="Rechercher"><Search /></button>
            <NotificationMenu />
            {onExport && <button className="export-button" onClick={onExport}><Download /> Exporter</button>}
          </div>
        </header>

        <div className="page-body">{children}</div>
      </main>
    </div>
  )
}
