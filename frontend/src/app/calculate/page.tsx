'use client'

import { useState } from 'react'
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
        <h1 className="text-xl font-semibold">Calculate</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run tax calculations via the IRS taxpayer MCP server.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Federal Tax */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Federal Tax</h2>
          <Button
            size="sm"
            disabled={loading.calc}
            onClick={() => run('calc', taxReturn.calculate, setCalcResult)}
          >
            {loading.calc ? 'Calculating…' : 'Calculate'}
          </Button>
        </div>
        {calcResult && (
          <div className="border border-border rounded-lg p-4 space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Federal Tax" value={fmt(calcResult.federal_tax)} />
              <Stat label="Effective Rate" value={pct(calcResult.effective_rate)} />
            </div>
            {calcResult.brackets.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Bracket Breakdown</p>
                <div className="space-y-1">
                  {calcResult.brackets.map((b, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{pct(b.rate)} bracket</span>
                      <span className="tabular-nums">{fmt(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(calcResult.credits).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Credits Applied</p>
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
          <h2 className="text-sm font-semibold">Compare Filing Statuses</h2>
          <Button
            size="sm"
            disabled={loading.compare}
            onClick={() => run('compare', taxReturn.compareStatus, setComparison)}
          >
            {loading.compare ? 'Comparing…' : 'Compare'}
          </Button>
        </div>
        {comparison && (
          <div className="border border-border rounded-lg p-4 text-sm space-y-3">
            <p className="text-xs">
              Recommended:{' '}
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
                    Tax {fmt(s.tax)} · Refund {fmt(s.refund)}
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
          <h2 className="text-sm font-semibold">Check Credits</h2>
          <Button
            size="sm"
            disabled={loading.credits}
            onClick={() => run('credits', taxReturn.checkCredits, setCredits)}
          >
            {loading.credits ? 'Checking…' : 'Check Credits'}
          </Button>
        </div>
        {credits && (
          <div className="border border-border rounded-lg p-4 text-sm space-y-3">
            <div className="flex justify-between items-center">
              <span className="font-medium">Total Eligible</span>
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
              <p className="text-xs text-muted-foreground">No eligible credits found.</p>
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
