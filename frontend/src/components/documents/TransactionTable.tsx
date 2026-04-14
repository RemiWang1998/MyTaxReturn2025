'use client'

import { useState } from 'react'

interface Transaction {
  [key: string]: string | number | boolean | null | undefined
}

interface Props {
  transactions: Transaction[]
  pageSize?: number
}

const CURRENCY_FIELDS = new Set([
  'proceeds', 'cost_or_other_basis', 'gain_or_loss',
  'wash_sale_loss_disallowed', 'accrued_market_discount',
])

function formatValue(key: string, value: Transaction[string]): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (CURRENCY_FIELDS.has(key)) {
      return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    }
    return value.toLocaleString()
  }
  return String(value)
}

function gainLossColor(key: string, value: Transaction[string]): string {
  if (key !== 'gain_or_loss' || typeof value !== 'number') return ''
  return value >= 0 ? 'text-green-600' : 'text-red-600'
}

export function TransactionTable({ transactions, pageSize = 20 }: Props) {
  const [page, setPage] = useState(0)

  if (!transactions.length) {
    return <p className="text-sm text-muted-foreground italic">No transactions found.</p>
  }

  const columns = Object.keys(transactions[0])
  const totalPages = Math.ceil(transactions.length / pageSize)
  const pageRows = transactions.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="text-xs w-full border-collapse">
          <thead>
            <tr className="bg-muted/60 border-b border-border">
              <th className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">#</th>
              {columns.map((col) => (
                <th key={col} className="text-left px-2 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
                  {col.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((tx, i) => {
              const globalIdx = page * pageSize + i
              return (
                <tr key={globalIdx} className={`border-b border-border last:border-0 ${globalIdx % 2 === 1 ? 'bg-muted/20' : ''}`}>
                  <td className="px-2 py-1.5 text-muted-foreground">{globalIdx + 1}</td>
                  {columns.map((col) => (
                    <td key={col} className={`px-2 py-1.5 whitespace-nowrap ${gainLossColor(col, tx[col])}`}>
                      {col === 'term' && tx[col] ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          tx[col] === 'long-term'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                            : 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400'
                        }`}>
                          {String(tx[col])}
                        </span>
                      ) : (
                        formatValue(col, tx[col])
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {transactions.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-medium">
                <td className="px-2 py-1.5 text-muted-foreground" colSpan={2}>Total</td>
                {columns.slice(1).map((col) => {
                  if (!CURRENCY_FIELDS.has(col)) return <td key={col} className="px-2 py-1.5" />
                  const sum = transactions.reduce((acc, tx) => acc + (typeof tx[col] === 'number' ? (tx[col] as number) : 0), 0)
                  return (
                    <td key={col} className={`px-2 py-1.5 whitespace-nowrap ${sum >= 0 ? '' : 'text-red-600'}`}>
                      {sum.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, transactions.length)} of {transactions.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-1.5 py-0.5 rounded border border-border disabled:opacity-40 hover:bg-accent"
            >«</button>
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="px-1.5 py-0.5 rounded border border-border disabled:opacity-40 hover:bg-accent"
            >‹</button>
            <span className="px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages - 1}
              className="px-1.5 py-0.5 rounded border border-border disabled:opacity-40 hover:bg-accent"
            >›</button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page === totalPages - 1}
              className="px-1.5 py-0.5 rounded border border-border disabled:opacity-40 hover:bg-accent"
            >»</button>
          </div>
        </div>
      )}
    </div>
  )
}
