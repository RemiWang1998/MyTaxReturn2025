'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { documents, extraction } from '@/lib/api'
import type { Document, ExtractionResult } from '@/lib/api'
import { Button } from '@/components/ui/button'

function confidenceBorder(conf: number) {
  if (conf >= 0.8) return 'border-border'
  if (conf >= 0.5) return 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
  return 'border-red-400 bg-red-50 dark:bg-red-900/20'
}

export default function ReviewPage() {
  const t = useTranslations('review')
  const [docs, setDocs] = useState<Document[]>([])
  const [results, setResults] = useState<Record<string, ExtractionResult[]>>({})
  // edits and saving are keyed by extraction result ID (string)
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [subIdx, setSubIdx] = useState(0)

  useEffect(() => {
    documents.list().then((all) => {
      const extracted = all.filter((d) => d.status === 'extracted')
      setDocs(extracted)
      if (extracted.length > 0) setSelected(extracted[0].id)
      Promise.all(
        extracted.map((d) => extraction.results(d.id).then((r) => ({ id: d.id, r })))
      ).then((pairs) => {
        const map: Record<string, ExtractionResult[]> = {}
        pairs.forEach(({ id, r }) => { map[id] = r })
        setResults(map)
      })
    })
  }, [])

  function handleSelectDoc(docId: string) {
    setSelected(docId)
    setSubIdx(0)
  }

  function setEdit(resultId: string, field: string, value: string) {
    setEdits((e) => ({ ...e, [resultId]: { ...e[resultId], [field]: value } }))
  }

  async function handleSave(result: ExtractionResult) {
    const rid = String(result.id)
    setSaving((s) => ({ ...s, [rid]: true }))
    const resultEdits = edits[rid] ?? {}
    const merged = { ...result.data, ...resultEdits }
    try {
      const updated = await extraction.update(rid, merged)
      setResults((prev) => {
        const docResults = prev[String(result.document_id)] ?? []
        return {
          ...prev,
          [String(result.document_id)]: docResults.map((r) =>
            r.id === result.id ? updated : r
          ),
        }
      })
      setEdits((e) => ({ ...e, [rid]: {} }))
    } catch (err) {
      alert(String(err))
    } finally {
      setSaving((s) => ({ ...s, [rid]: false }))
    }
  }

  if (docs.length === 0) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold">{t('emptyHeading')}</h1>
        <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
      </div>
    )
  }

  const docResults = selected ? (results[selected] ?? []) : []
  const result = docResults[subIdx] ?? null
  const rid = result ? String(result.id) : ''
  const resultEdits = rid ? (edits[rid] ?? {}) : {}
  const hasEdits = Object.keys(resultEdits).length > 0

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {/* Document tabs */}
      <div className="flex gap-2 flex-wrap">
        {docs.map((doc) => (
          <button
            key={doc.id}
            onClick={() => handleSelectDoc(doc.id)}
            className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
              selected === doc.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border hover:bg-accent'
            }`}
          >
            {doc.filename}
          </button>
        ))}
      </div>

      {/* Sub-form tabs (only if document has multiple results) */}
      {docResults.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {docResults.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setSubIdx(i)}
              className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors uppercase ${
                subIdx === i
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {r.form_type}
            </button>
          ))}
        </div>
      )}

      {selected && result ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{result.form_type}</span>
              <span className="text-muted-foreground text-xs">
                {t('avgConfidence', { pct: (result.confidence * 100).toFixed(0) })}
              </span>
              {result.user_verified && (
                <span className="text-xs text-green-600 font-medium">{t('verified')}</span>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => handleSave(result)}
              disabled={saving[rid] || !hasEdits}
            >
              {saving[rid] ? t('saving') : t('saveChanges')}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(result.data).map(([field, value]) => {
              const conf = result.field_confidences[field] ?? 1
              const current =
                resultEdits[field] !== undefined ? resultEdits[field] : String(value ?? '')
              return (
                <div key={field} className={`border rounded-md p-2.5 ${confidenceBorder(conf)}`}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium capitalize text-muted-foreground">
                      {field.replace(/_/g, ' ')}
                    </label>
                    {conf < 0.8 && (
                      <span className="text-[10px] text-muted-foreground">
                        {(conf * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={current}
                    onChange={(e) => setEdit(rid, field, e.target.value)}
                    className="w-full text-sm bg-transparent outline-none text-foreground"
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : selected && docResults.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : null}
    </div>
  )
}
