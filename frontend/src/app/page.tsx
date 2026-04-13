'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiKeys, documents, taxReturn } from '@/lib/api'
import type { Document, TaxSummary } from '@/lib/api'

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const [docs, setDocs] = useState<Document[]>([])
  const [summary, setSummary] = useState<TaxSummary | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      documents.list().then(setDocs),
      taxReturn.summary().then(setSummary),
      apiKeys.list().then((keys) => setHasApiKey(keys.length > 0)),
    ]).finally(() => setLoading(false))
  }, [])

  const extracted = docs.filter((d) => d.status === 'extracted').length
  const stepDone = [hasApiKey, docs.length > 0, !!summary?.estimated_tax, false]

  const steps = [
    { num: 1, label: t('step1'), href: '/settings' },
    { num: 2, label: t('step2'), href: '/documents' },
    { num: 3, label: t('step4'), href: '/calculate' },
    { num: 4, label: t('step5'), href: '/filing' },
  ]

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('statDocuments')} value={loading ? '…' : String(docs.length)} />
        <StatCard label={t('statExtracted')} value={loading ? '…' : String(extracted)} />
        <StatCard
          label={t('statRefund')}
          value={loading || !summary ? '…' : fmt(summary.estimated_refund)}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t('steps')}
        </h2>
        <ol className="space-y-1.5">
          {steps.map((step, i) => (
            <li key={step.num}>
              <Link
                href={step.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors text-sm ${
                  stepDone[i]
                    ? 'border-green-200 bg-green-50 hover:bg-green-100 dark:border-green-900 dark:bg-green-950/40 dark:hover:bg-green-950/60'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    stepDone[i]
                      ? 'bg-green-600 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {stepDone[i] ? '✓' : step.num}
                </span>
                <span className={stepDone[i] ? 'text-green-800 dark:text-green-300 font-medium' : 'text-muted-foreground'}>
                  {step.label}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}
