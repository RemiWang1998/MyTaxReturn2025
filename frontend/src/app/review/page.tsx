'use client'

import { useEffect, useState } from 'react'
import { documents, extraction } from '@/lib/api'
import type { Document, ExtractionResult } from '@/lib/api'
import { Button } from '@/components/ui/button'

function confidenceBorder(conf: number) {
  if (conf >= 0.8) return 'border-border'
  if (conf >= 0.5) return 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
  return 'border-red-400 bg-red-50 dark:bg-red-900/20'
}

export default function ReviewPage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [results, setResults] = useState<Record<string, ExtractionResult>>({})
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    documents.list().then((all) => {
      const extracted = all.filter((d) => d.status === 'extracted')
      setDocs(extracted)
      if (extracted.length > 0) setSelected(extracted[0].id)
      Promise.all(
        extracted.map((d) => extraction.result(d.id).then((r) => ({ id: d.id, r })))
      ).then((pairs) => {
        const map: Record<string, ExtractionResult> = {}
        pairs.forEach(({ id, r }) => { map[id] = r })
        setResults(map)
      })
    })
  }, [])

  function setEdit(docId: string, field: string, value: string) {
    setEdits((e) => ({ ...e, [docId]: { ...e[docId], [field]: value } }))
  }

  async function handleSave(docId: string) {
    const result = results[docId]
    if (!result) return
    setSaving((s) => ({ ...s, [docId]: true }))
    const merged = { ...result.data, ...edits[docId] }
    try {
      const updated = await extraction.update(docId, merged)
      setResults((r) => ({ ...r, [docId]: updated }))
      setEdits((e) => ({ ...e, [docId]: {} }))
    } catch (err) {
      alert(String(err))
    } finally {
      setSaving((s) => ({ ...s, [docId]: false }))
    }
  }

  if (docs.length === 0) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold">Review</h1>
        <p className="text-sm text-muted-foreground">
          No extracted documents yet. Go to{' '}
          <a href="/documents" className="underline">
            Documents
          </a>{' '}
          to upload and extract.
        </p>
      </div>
    )
  }

  const result = selected ? results[selected] : null
  const docEdits = selected ? (edits[selected] ?? {}) : {}
  const hasEdits = Object.keys(docEdits).length > 0

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and correct extracted fields. Yellow = low confidence, red = very low.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {docs.map((doc) => (
          <button
            key={doc.id}
            onClick={() => setSelected(doc.id)}
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

      {selected && result ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-medium">{result.form_type}</span>
              <span className="text-muted-foreground text-xs">
                Avg confidence: {(result.confidence * 100).toFixed(0)}%
              </span>
              {result.user_verified && (
                <span className="text-xs text-green-600 font-medium">Verified</span>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => handleSave(selected)}
              disabled={saving[selected] || !hasEdits}
            >
              {saving[selected] ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(result.data).map(([field, value]) => {
              const conf = result.field_confidences[field] ?? 1
              const current =
                docEdits[field] !== undefined ? docEdits[field] : String(value ?? '')
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
                    onChange={(e) => setEdit(selected, field, e.target.value)}
                    className="w-full text-sm bg-transparent outline-none text-foreground"
                  />
                </div>
              )
            })}
          </div>
        </div>
      ) : selected && !result ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
    </div>
  )
}
