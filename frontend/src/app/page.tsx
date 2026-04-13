'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { documents, taxReturn } from '@/lib/api'
import type { Document, TaxSummary } from '@/lib/api'

const steps = [
  { num: 1, label: 'Add API Key', href: '/settings' },
  { num: 2, label: 'Upload Documents', href: '/documents' },
  { num: 3, label: 'Review Extracted Data', href: '/review' },
  { num: 4, label: 'Calculate Tax', href: '/calculate' },
  { num: 5, label: 'File Return', href: '/filing' },
]

export default function DashboardPage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [summary, setSummary] = useState<TaxSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      documents.list().then(setDocs),
      taxReturn.summary().then(setSummary),
    ]).finally(() => setLoading(false))
  }, [])

  const extracted = docs.filter((d) => d.status === 'extracted').length
  const stepDone = [false, docs.length > 0, extracted > 0, !!summary?.estimated_tax, false]

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tax Year 2025 — all data stays on your machine.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Documents" value={loading ? '…' : String(docs.length)} />
        <StatCard label="Extracted" value={loading ? '…' : String(extracted)} />
        <StatCard
          label="Est. Refund"
          value={loading || !summary ? '…' : fmt(summary.estimated_refund)}
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Steps
        </h2>
        <ol className="space-y-1.5">
          {steps.map((step, i) => (
            <li key={step.num}>
              <Link
                href={step.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-accent transition-colors text-sm"
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    stepDone[i]
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {stepDone[i] ? '✓' : step.num}
                </span>
                <span className={stepDone[i] ? 'text-foreground' : 'text-muted-foreground'}>
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
