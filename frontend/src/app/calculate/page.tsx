'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { taxReturn } from '@/lib/api'
import type { CalcResult, StatusComparison, CreditsResult } from '@/lib/api'
import { Button } from '@/components/ui/button'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export default function CalculatePage() {
  const t = useTranslations('calculate')
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [comparison, setComparison] = useState<StatusComparison | null>(null)
  const [credits, setCredits] = useState<CreditsResult | null>(null)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')

  async function run<T>(key: string, fn: () => Promise<T>, onSuccess: (v: T) => void) {
    setLoading((l) => ({ ...l, [key]: true }))
    setError('')
    try {
      const res = await fn()
      onSuccess(res)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading((l) => ({ ...l, [key]: false }))
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Federal Tax */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('federalTax')}</h2>
          <Button
            size="sm"
            disabled={loading.calc}
            onClick={() => run('calc', taxReturn.calculate, setCalcResult)}
          >
            {loading.calc ? t('calculating') : t('calculate')}
          </Button>
        </div>
        {calcResult && (
          <div className="border border-border rounded-lg p-4 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('federalTax')} value={fmt(calcResult.federal_tax)} />
              <Stat label={t('effectiveRate')} value={pct(calcResult.effective_rate)} />
            </div>
            {calcResult.brackets.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">{t('bracketBreakdown')}</p>
                <div className="space-y-1">
                  {calcResult.brackets.map((b, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{t('bracketLabel', { pct: pct(b.rate) })}</span>
                      <span className="tabular-nums">{fmt(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(calcResult.credits).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">{t('creditsApplied')}</p>
                <div className="space-y-1">
                  {Object.entries(calcResult.credits).map(([name, amt]) => (
                    <div key={name} className="flex justify-between text-xs">
                      <span className="text-muted-foreground capitalize">
                        {name.replace(/_/g, ' ')}
                      </span>
                      <span className="tabular-nums">{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Filing Status Comparison */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('compareStatuses')}</h2>
          <Button
            size="sm"
            disabled={loading.compare}
            onClick={() => run('compare', taxReturn.compareStatus, setComparison)}
          >
            {loading.compare ? t('comparing') : t('compare')}
          </Button>
        </div>
        {comparison && (
          <div className="border border-border rounded-lg p-4 text-sm space-y-3">
            <p className="text-xs">
              {t('recommended')}{' '}
              <span className="font-semibold text-foreground">{comparison.recommended}</span>
            </p>
            <div className="space-y-1">
              {comparison.statuses.map((s, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center text-xs px-2 py-1.5 rounded ${
                    s.status === comparison.recommended ? 'bg-primary/10 font-medium' : ''
                  }`}
                >
                  <span>{s.status}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {t('taxRefund', { tax: fmt(s.tax), refund: fmt(s.refund) })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Credits */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('checkCredits')}</h2>
          <Button
            size="sm"
            disabled={loading.credits}
            onClick={() => run('credits', taxReturn.checkCredits, setCredits)}
          >
            {loading.credits ? t('checking') : t('checkCredits')}
          </Button>
        </div>
        {credits && (
          <div className="border border-border rounded-lg p-4 text-sm space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-medium">{t('totalEligible')}</span>
              <span className="tabular-nums font-semibold">{fmt(credits.total)}</span>
            </div>
            {credits.eligible.length > 0 && (
              <div className="space-y-1">
                {credits.eligible.map((c, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{c.name}</span>
                    <span className="tabular-nums">{fmt(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {credits.eligible.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('noCredits')}</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}
