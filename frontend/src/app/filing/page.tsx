'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { taxReturn } from '@/lib/api'
import type { CalcResult, FormsDetail, W2Form, Int1099, Div1099, Nec1099, Misc1099, B1099, R1099, G1099, Da1099, S1099 } from '@/lib/api'
import { Button } from '@/components/ui/button'

const OLT_URL = 'https://www.olt.com'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

interface SummaryData {
  tax_year: number; filing_status: string; total_income: number
  wages: number; interest_income: number; ordinary_dividends: number
  qualified_dividends: number; nonemployee_compensation: number
  capital_gains: number; other_income: number; federal_tax_withheld: number
  state_wages: Record<string, number>; state_tax_withheld: Record<string, number>
}

function Row({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between items-start py-2 border-b border-border last:border-0 text-sm gap-4 ${highlight ? 'font-semibold' : ''}`}>
      <span className={`${highlight ? '' : 'text-muted-foreground'} shrink-0`}>
        {label}
        {sub && <span className="block text-xs font-normal text-muted-foreground/70">{sub}</span>}
      </span>
      <span className="tabular-nums text-right">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="border border-border rounded-lg px-4">{children}</div>
}

function FormCard({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg">
      <div className="px-4 py-2 border-b border-border bg-muted/40 rounded-t-lg">
        <p className="text-sm font-medium">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className="px-4">{children}</div>
    </div>
  )
}

function ColorRow({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  const color = positive
    ? value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
    : ''
  return (
    <div className={`flex justify-between items-center py-2 border-b border-border last:border-0 text-sm font-semibold ${color}`}>
      <span>{label}</span>
      <span className="tabular-nums">{fmt(value)}</span>
    </div>
  )
}

// --- per-form sub-components ---

function W2Card({ w, t }: { w: W2Form; t: (k: string) => string }) {
  return (
    <FormCard label={w.employer ?? t('unknown')} sub={w.employer_ein ? `EIN ${w.employer_ein}` : undefined}>
      {w.wages > 0 && <Row label={t('wages')} value={fmt(w.wages)} />}
      {w.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(w.federal_withheld)} />}
      {w.social_security_wages > 0 && <Row label={t('ssWages')} value={fmt(w.social_security_wages)} />}
      {w.social_security_withheld > 0 && <Row label={t('ssWithheld')} value={fmt(w.social_security_withheld)} />}
      {w.medicare_wages > 0 && <Row label={t('medicareWages')} value={fmt(w.medicare_wages)} />}
      {w.medicare_withheld > 0 && <Row label={t('medicareWithheld')} value={fmt(w.medicare_withheld)} />}
      {w.state && <Row label={t('state')} value={w.state} />}
      {w.state_wages > 0 && <Row label={t('stateWages')} value={fmt(w.state_wages)} />}
      {w.state_withheld > 0 && <Row label={t('stateWithheld')} value={fmt(w.state_withheld)} />}
    </FormCard>
  )
}

function Int1099Card({ f, t }: { f: Int1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')}>
      {f.interest > 0 && <Row label={t('interest')} value={fmt(f.interest)} />}
      {f.us_bond_interest > 0 && <Row label={t('usBondInterest')} value={fmt(f.us_bond_interest)} />}
      {f.early_withdrawal_penalty > 0 && <Row label={t('earlyWithdrawal')} value={fmt(f.early_withdrawal_penalty)} />}
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function Div1099Card({ f, t }: { f: Div1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')}>
      {f.ordinary_dividends > 0 && <Row label={t('ordinaryDividends')} value={fmt(f.ordinary_dividends)} />}
      {f.qualified_dividends > 0 && <Row label={t('qualifiedDividends')} value={fmt(f.qualified_dividends)} />}
      {f.total_capital_gain > 0 && <Row label={t('capitalGainDistrib')} value={fmt(f.total_capital_gain)} />}
      {f.exempt_interest_dividends > 0 && <Row label={t('exemptInterest')} value={fmt(f.exempt_interest_dividends)} />}
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function Nec1099Card({ f, t }: { f: Nec1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')}>
      {f.amount > 0 && <Row label={t('nonemployeeComp')} value={fmt(f.amount)} />}
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function Misc1099Card({ f, t }: { f: Misc1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')}>
      {f.rents > 0 && <Row label={t('rents')} value={fmt(f.rents)} />}
      {f.royalties > 0 && <Row label={t('royalties')} value={fmt(f.royalties)} />}
      {f.other_income > 0 && <Row label={t('otherIncome')} value={fmt(f.other_income)} />}
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function B1099Card({ f, t }: { f: B1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')} sub={f.transaction_count > 0 ? `${f.transaction_count} ${t('transactions')}` : undefined}>
      {f.proceeds > 0 && <Row label={t('proceeds')} value={fmt(f.proceeds)} />}
      {f.cost_basis > 0 && <Row label={t('costBasis')} value={fmt(f.cost_basis)} />}
      <ColorRow label={t('gainLoss')} value={f.gain_loss} positive />
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function R1099Card({ f, t }: { f: R1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')} sub={f.distribution_code ? `${t('distCode')} ${f.distribution_code}` : undefined}>
      {f.gross_distribution > 0 && <Row label={t('grossDistribution')} value={fmt(f.gross_distribution)} />}
      {f.taxable_amount > 0 && <Row label={t('taxableAmount')} value={fmt(f.taxable_amount)} />}
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function G1099Card({ f, t }: { f: G1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')}>
      {f.unemployment_compensation > 0 && <Row label={t('unemployment')} value={fmt(f.unemployment_compensation)} />}
      {f.state_local_refund > 0 && <Row label={t('stateLocalRefund')} value={fmt(f.state_local_refund)} />}
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function Da1099Card({ f, t }: { f: Da1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')} sub={f.transaction_count > 0 ? `${f.transaction_count} ${t('transactions')}` : undefined}>
      <ColorRow label={t('gainLoss')} value={f.gain_loss} positive />
      {f.federal_withheld > 0 && <Row label={t('federalWithheld')} value={fmt(f.federal_withheld)} />}
    </FormCard>
  )
}

function S1099Card({ f, t }: { f: S1099; t: (k: string) => string }) {
  return (
    <FormCard label={f.payer ?? t('unknown')}>
      {f.proceeds > 0 && <Row label={t('proceeds')} value={fmt(f.proceeds)} />}
      {f.cost_basis > 0 && <Row label={t('costBasis')} value={fmt(f.cost_basis)} />}
      <ColorRow label={t('gainLoss')} value={f.gain_loss} positive />
    </FormCard>
  )
}

export default function FilingPage() {
  const t = useTranslations('filing')
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [calc, setCalc] = useState<CalcResult | null>(null)
  const [forms, setForms] = useState<FormsDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([taxReturn.summary(), taxReturn.calculate(), taxReturn.forms()])
      .then(([s, c, f]) => {
        setSummary(s as unknown as SummaryData)
        setCalc(c)
        setForms(f)
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [])

  const hasW2 = (forms?.w2.length ?? 0) > 0
  const has1099Int = (forms?.['1099_int'].length ?? 0) > 0
  const has1099Div = (forms?.['1099_div'].length ?? 0) > 0
  const has1099Nec = (forms?.['1099_nec'].length ?? 0) > 0
  const has1099Misc = (forms?.['1099_misc'].length ?? 0) > 0
  const has1099B = (forms?.['1099_b'].length ?? 0) > 0
  const has1099R = (forms?.['1099_r'].length ?? 0) > 0
  const has1099G = (forms?.['1099_g'].length ?? 0) > 0
  const has1099Da = (forms?.['1099_da'].length ?? 0) > 0
  const has1099S = (forms?.['1099_s'].length ?? 0) > 0

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Button onClick={() => window.open(OLT_URL, '_blank', 'noopener,noreferrer')}>
        {t('openOlt')}
      </Button>

      {loading && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <>
          {/* Filing basics */}
          <Section title={t('sectionBasics')}>
            <Card>
              <Row label={t('taxYear')} value={String(summary.tax_year)} highlight />
              <Row label={t('filingStatus')} value={summary.filing_status.replace(/_/g, ' ')} highlight />
            </Card>
          </Section>

          {/* W-2 */}
          {hasW2 && (
            <Section title="W-2 — Wages">
              {forms!.w2.map((w, i) => <W2Card key={i} w={w} t={t} />)}
            </Section>
          )}

          {/* 1099-INT */}
          {has1099Int && (
            <Section title="1099-INT — Interest Income">
              {forms!['1099_int'].map((f, i) => <Int1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-DIV */}
          {has1099Div && (
            <Section title="1099-DIV — Dividends">
              {forms!['1099_div'].map((f, i) => <Div1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-NEC */}
          {has1099Nec && (
            <Section title="1099-NEC — Nonemployee Compensation">
              {forms!['1099_nec'].map((f, i) => <Nec1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-MISC */}
          {has1099Misc && (
            <Section title="1099-MISC — Miscellaneous Income">
              {forms!['1099_misc'].map((f, i) => <Misc1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-B */}
          {has1099B && (
            <Section title="1099-B — Capital Gains / Brokerage">
              {forms!['1099_b'].map((f, i) => <B1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-DA */}
          {has1099Da && (
            <Section title="1099-DA — Digital Assets">
              {forms!['1099_da'].map((f, i) => <Da1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-S */}
          {has1099S && (
            <Section title="1099-S — Real Estate Proceeds">
              {forms!['1099_s'].map((f, i) => <S1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-R */}
          {has1099R && (
            <Section title="1099-R — Retirement Distributions">
              {forms!['1099_r'].map((f, i) => <R1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* 1099-G */}
          {has1099G && (
            <Section title="1099-G — Government Payments">
              {forms!['1099_g'].map((f, i) => <G1099Card key={i} f={f} t={t} />)}
            </Section>
          )}

          {/* Federal Summary */}
          {calc && (
            <Section title={t('sectionFederal')}>
              <Card>
                <Row label={t('totalIncome')} value={fmt(summary.total_income)} highlight />
                <Row label={t('federalTax')} value={fmt(calc.federal_tax)} />
                <Row label={t('withheld')} value={fmt(summary.federal_tax_withheld)} />
                {calc.effective_rate != null && <Row label={t('effectiveRate')} value={pct(calc.effective_rate)} />}
                <ColorRow label={calc.refund >= 0 ? t('refund') : t('amountDue')} value={calc.refund} positive />
              </Card>

              {/* Brackets */}
              {(calc.brackets ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 px-1">{t('brackets')}</p>
                  <Card>
                    {calc.brackets.map((b, i) => (
                      <Row key={i} label={`${pct(b.rate)} bracket`} value={fmt(b.amount)} />
                    ))}
                  </Card>
                </div>
              )}

              {/* Credits */}
              {Object.keys(calc.credits ?? {}).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 px-1">{t('credits')}</p>
                  <Card>
                    {Object.entries(calc.credits).map(([name, amt]) => (
                      <Row key={name} label={name.replace(/_/g, ' ')} value={fmt(amt)} />
                    ))}
                  </Card>
                </div>
              )}
            </Section>
          )}

          {/* State */}
          {Object.keys(summary.state_wages).length > 0 && (
            <Section title={t('sectionState')}>
              {Object.entries(summary.state_wages).map(([state, wages]) => {
                const withheld = summary.state_tax_withheld[state] ?? 0
                const sc = calc?.states?.[state]
                return (
                  <FormCard key={state} label={state}>
                    <Row label={t('stateWages')} value={fmt(wages)} />
                    <Row label={t('stateWithheld')} value={fmt(withheld)} />
                    {sc && !sc.no_income_tax && (
                      <>
                        <Row label={t('stateTax')} value={fmt(sc.state_tax)} />
                        {sc.effective_rate > 0 && <Row label={t('effectiveRate')} value={pct(sc.effective_rate)} />}
                        <ColorRow label={sc.refund >= 0 ? t('refund') : t('amountDue')} value={sc.refund} positive />
                      </>
                    )}
                    {sc?.no_income_tax && <Row label="" value={t('noStateTax')} />}
                  </FormCard>
                )
              })}
            </Section>
          )}
        </>
      )}
    </div>
  )
}
