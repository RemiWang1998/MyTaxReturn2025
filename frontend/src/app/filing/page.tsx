'use client'

import { useTranslations } from 'next-intl'

export default function FilingPage() {
  const t = useTranslations('filing')
  return (
    <div className="max-w-2xl space-y-2">
      <h1 className="text-xl font-semibold">{t('heading')}</h1>
      <p className="text-sm text-muted-foreground">{t('comingSoon')}</p>
    </div>
  )
}
