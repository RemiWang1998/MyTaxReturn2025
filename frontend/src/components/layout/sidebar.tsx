'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LayoutDashboard, FileText, Calculator, Send, Settings } from 'lucide-react'

export function Sidebar() {
  const pathname = usePathname()
  const t = useTranslations('sidebar')

  const navItems = [
    { href: '/', label: t('dashboard'), icon: LayoutDashboard },
    { href: '/documents', label: t('documents'), icon: FileText },
    { href: '/calculate', label: t('calculate'), icon: Calculator },
    { href: '/filing', label: t('filing'), icon: Send },
    { href: '/settings', label: t('settings'), icon: Settings },
  ]

  return (
    <aside className="w-52 shrink-0 border-r border-border bg-sidebar flex flex-col h-full">
      <div className="px-4 py-4 border-b border-border">
        <h1 className="text-sm font-semibold text-sidebar-foreground leading-tight">
          {t('title')}
          <span className="block text-xs font-normal text-muted-foreground">{t('subtitle')}</span>
        </h1>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
