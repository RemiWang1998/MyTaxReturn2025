'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { taxReturn } from '@/lib/api'
import type { CalcResult, StateTaxResult } from '@/lib/api'
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
            {/* Income Summary */}
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('totalIncome')} value={fmt(calcResult.total_income)} />
              <Stat label={t('wages')} value={fmt(calcResult.wages)} />
              <Stat label={t('capitalGains')} value={fmt(calcResult.capital_gains)} />
            </div>
            <hr className="border-border" />
            {/* Refund / Amount Due */}
            <div className={`rounded-md px-4 py-3 text-center ${calcResult.refund >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              <p className="text-xs text-muted-foreground mb-0.5">
                {calcResult.refund >= 0 ? t('estimatedRefund') : t('amountDue')}
              </p>
              <p className={`text-2xl font-bold tabular-nums ${calcResult.refund >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {fmt(Math.abs(calcResult.refund))}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('federalTax')} value={fmt(calcResult.federal_tax)} />
              <Stat label={t('withheld')} value={fmt(calcResult.federal_tax_withheld)} />
              {calcResult.effective_rate != null && (
                <Stat label={t('effectiveRate')} value={pct(calcResult.effective_rate)} />
              )}
            </div>
            {(calcResult.brackets ?? []).length > 0 && (
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
            {Object.keys(calcResult.credits ?? {}).length > 0 && (
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

      {/* State Tax */}
      {calcResult && Object.keys(calcResult.states ?? {}).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t('stateTax')}</h2>
          {Object.entries(calcResult.states).map(([code, s]) => (
            <StateTaxCard key={code} stateCode={code} result={s} fmt={fmt} pct={pct} t={t} />
          ))}
        </section>
      )}

      {/* Filing Status Comparison — hidden */}
      {false && <section className="space-y-3">
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
      </section>}

    </div>
  )
}

function StateTaxCard({
  stateCode,
  result,
  fmt,
  pct,
  t,
}: {
  stateCode: string
  result: StateTaxResult
  fmt: (n: number) => string
  pct: (n: number) => string
  t: (key: string) => string
}) {
  if (result.no_income_tax) {
    return (
      <div className="border border-border rounded-lg p-4 text-sm">
        <p className="font-medium mb-1">{stateCode}</p>
        <p className="text-xs text-muted-foreground">{t('noStateTax')}</p>
      </div>
    )
  }
  return (
    <div className="border border-border rounded-lg p-4 space-y-3 text-sm">
      <p className="font-medium">{stateCode}</p>
      <div className={`rounded-md px-4 py-2.5 text-center ${result.refund >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        <p className="text-xs text-muted-foreground mb-0.5">
          {result.refund >= 0 ? t('estimatedRefund') : t('amountDue')}
        </p>
        <p className={`text-xl font-bold tabular-nums ${result.refund >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {fmt(Math.abs(result.refund))}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('stateTaxLabel')} value={fmt(result.state_tax)} />
        <Stat label={t('withheld')} value={fmt(result.state_tax_withheld)} />
        {result.effective_rate > 0 && (
          <Stat label={t('effectiveRate')} value={pct(result.effective_rate)} />
        )}
      </div>
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
