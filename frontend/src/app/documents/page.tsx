'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { documents, extraction } from '@/lib/api'
import type { Document, ExtractionResult } from '@/lib/api'
import { Button } from '@/components/ui/button'

const LOW_CONF_THRESHOLD = 0.8
const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.zip'
const MAX_MB = 50

const DOC_TYPES = [
  'w2', '1099-nec', '1099-int', '1099-div', '1099-misc',
  '1099-b', '1099-da', '1099-g', '1099-consolidated', 'other',
] as const

function confidenceBorder(conf: number) {
  if (conf >= 0.8) return 'border-border'
  if (conf >= 0.5) return 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
  return 'border-red-400 bg-red-50 dark:bg-red-900/20'
}

export default function DocumentsPage() {
  const t = useTranslations('documents')
  const tR = useTranslations('review')

  const [docs, setDocs] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState<Record<string, boolean>>({})
  const [batchExtracting, setBatchExtracting] = useState(false)
  const [batchReExtracting, setBatchReExtracting] = useState(false)
  const [batchLowConfExtracting, setBatchLowConfExtracting] = useState(false)
  const [confidences, setConfidences] = useState<Record<string, number>>({})
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // review panel
  const [selected, setSelected] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ExtractionResult[]>>({})
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [subIdx, setSubIdx] = useState(0)

  const statusLabel: Record<Document['status'], string> = {
    uploaded: t('statusUploaded'),
    extracting: t('statusExtracting'),
    extracted: t('statusExtracted'),
    error: t('statusError'),
  }

  const statusColor: Record<Document['status'], string> = {
    uploaded: 'text-muted-foreground',
    extracting: 'text-yellow-600',
    extracted: 'text-green-600',
    error: 'text-destructive',
  }

  const load = () =>
    documents.list().then((all) => {
      setDocs(all)
      const extracted = all.filter((d) => d.status === 'extracted')
      Promise.allSettled(extracted.map((d) => extraction.results(d.id))).then((settled) => {
        const confMap: Record<string, number> = {}
        const resMap: Record<string, ExtractionResult[]> = {}
        settled.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            const arr = r.value as ExtractionResult[]
            if (arr.length > 0) {
              confMap[extracted[i].id] = Math.min(...arr.map((x) => x.confidence))
              resMap[extracted[i].id] = arr
            }
          }
        })
        setConfidences(confMap)
        setResults((prev) => ({ ...prev, ...resMap }))
      })
    })

  useEffect(() => { load() }, [])

  async function handleFiles(files: File[]) {
    const valid = files.filter((f) => {
      if (f.size > MAX_MB * 1024 * 1024) { alert(`${f.name} exceeds ${MAX_MB} MB`); return false }
      return true
    })
    if (!valid.length) return
    setUploading(true)
    try { await documents.upload(valid); await load() }
    catch (err) { alert(String(err)) }
    finally { setUploading(false) }
  }

  async function handleExtract(docId: string) {
    setExtracting((e) => ({ ...e, [docId]: true }))
    try { await extraction.run(docId); await load() }
    catch (err) { alert(String(err)) }
    finally { setExtracting((e) => ({ ...e, [docId]: false })) }
  }

  async function handleBatchExtract() {
    const ids = docs.filter((d) => d.status === 'uploaded').map((d) => d.id)
    if (!ids.length) return
    setBatchExtracting(true)
    setExtracting(Object.fromEntries(ids.map((id) => [id, true])))
    try { await Promise.allSettled(ids.map((id) => extraction.run(id))); await load() }
    finally { setBatchExtracting(false); setExtracting({}) }
  }

  async function handleBatchReExtract() {
    const ids = docs.filter((d) => d.status === 'extracted' || d.status === 'error').map((d) => d.id)
    if (!ids.length) return
    setBatchReExtracting(true)
    setExtracting(Object.fromEntries(ids.map((id) => [id, true])))
    try { await Promise.allSettled(ids.map((id) => extraction.run(id))); await load() }
    finally { setBatchReExtracting(false); setExtracting({}) }
  }

  async function handleBatchLowConfExtract() {
    const ids = docs
      .filter((d) => d.status === 'extracted' && (confidences[d.id] ?? 1) < LOW_CONF_THRESHOLD)
      .map((d) => d.id)
    if (!ids.length) return
    setBatchLowConfExtracting(true)
    setExtracting(Object.fromEntries(ids.map((id) => [id, true])))
    try { await Promise.allSettled(ids.map((id) => extraction.run(id))); await load() }
    finally { setBatchLowConfExtracting(false); setExtracting({}) }
  }

  async function handleDocTypeChange(docId: string, value: string) {
    const doc_type = value === '' ? null : value
    await documents.updateDocType(docId, doc_type)
    await load()
  }

  async function handleDelete(docId: string) {
    if (selected === docId) setSelected(null)
    await documents.delete(docId)
    load()
  }

  function setEdit(resultId: string, field: string, value: string) {
    setEdits((e) => ({ ...e, [resultId]: { ...e[resultId], [field]: value } }))
  }

  async function handleSave(result: ExtractionResult) {
    const rid = String(result.id)
    setSaving((s) => ({ ...s, [rid]: true }))
    const merged = { ...result.data, ...(edits[rid] ?? {}) }
    try {
      const updated = await extraction.update(rid, merged)
      setResults((prev) => {
        const docResults = prev[String(result.document_id)] ?? []
        return { ...prev, [String(result.document_id)]: docResults.map((r) => r.id === result.id ? updated : r) }
      })
      setEdits((e) => ({ ...e, [rid]: {} }))
    } catch (err) { alert(String(err)) }
    finally { setSaving((s) => ({ ...s, [rid]: false })) }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  const selectedDoc = selected ? docs.find((d) => d.id === selected) ?? null : null
  const docResults = selected ? (results[selected] ?? []) : []
  const result = docResults[subIdx] ?? null
  const rid = result ? String(result.id) : ''
  const resultEdits = rid ? (edits[rid] ?? {}) : {}
  const hasEdits = Object.keys(resultEdits).length > 0

  return (
    <div className="flex gap-6 min-h-0">
      {/* ── Left: document list ── */}
      <div className="w-108 shrink-0 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('heading')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>

        {/* Batch buttons */}
        <div className="flex flex-wrap gap-2">
          {docs.some((d) => d.status === 'uploaded') && (
            <Button size="sm" disabled={batchExtracting} onClick={handleBatchExtract}>
              {batchExtracting ? t('extractingAll') : t('extractAll')}
            </Button>
          )}
          {docs.some((d) => d.status === 'extracted' || d.status === 'error') && (
            <Button variant="outline" size="sm" disabled={batchReExtracting} onClick={handleBatchReExtract}>
              {batchReExtracting ? t('extractingAll') : t('reExtractAll')}
            </Button>
          )}
          {docs.some((d) => d.status === 'extracted' && (confidences[d.id] ?? 1) < LOW_CONF_THRESHOLD) && (
            <Button variant="outline" size="sm" disabled={batchLowConfExtracting} onClick={handleBatchLowConfExtract}>
              {batchLowConfExtracting ? t('extractingAll') : t('reExtractLowConf')}
            </Button>
          )}
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors select-none ${
            dragOver ? 'border-primary bg-accent' : 'border-border hover:border-primary/60 hover:bg-accent/40'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED}
            className="sr-only"
            onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
          />
          <p className="text-sm text-muted-foreground">
            {uploading ? t('uploading') : t('dropzone')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{t('fileTypes', { max: MAX_MB })}</p>
        </div>

        {/* Document list */}
        {docs.length > 0 ? (
          <div className="space-y-1.5">
            {docs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => { setSelected(doc.id); setSubIdx(0) }}
                className={`border rounded-md p-2.5 text-sm cursor-pointer transition-colors space-y-2 ${
                  selected === doc.id
                    ? 'border-primary bg-accent/60'
                    : 'border-border hover:bg-accent/40'
                }`}
              >
                {/* Row 1: filename + status */}
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium" title={doc.filename}>{doc.filename}</span>
                  <span className={`text-xs shrink-0 ${statusColor[doc.status]}`}>
                    {statusLabel[doc.status]}
                  </span>
                </div>

                {/* Row 2: doc type + low-conf badge + actions */}
                <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={doc.doc_type ?? ''}
                    onChange={(e) => handleDocTypeChange(doc.id, e.target.value)}
                    disabled={extracting[doc.id]}
                    className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-foreground"
                  >
                    <option value="">{t('docTypeAuto')}</option>
                    {DOC_TYPES.map((type) => (
                      <option key={type} value={type}>{type.toUpperCase()}</option>
                    ))}
                  </select>

                  {doc.status === 'extracted' && confidences[doc.id] !== undefined && confidences[doc.id] < LOW_CONF_THRESHOLD && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400">
                      {(confidences[doc.id] * 100).toFixed(0)}% · {t('lowConfidence')}
                    </span>
                  )}

                  <div className="flex items-center gap-1 ml-auto">
                    {doc.status === 'uploaded' && (
                      <Button size="xs" onClick={() => handleExtract(doc.id)} disabled={extracting[doc.id]}>
                        {extracting[doc.id] ? t('extracting') : t('extract')}
                      </Button>
                    )}
                    {(doc.status === 'extracted' || doc.status === 'error') && (
                      <Button variant="outline" size="xs" onClick={() => handleExtract(doc.id)} disabled={extracting[doc.id]}>
                        {extracting[doc.id] ? t('extracting') : t('reExtract')}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(doc.id)} title="Delete">✕</Button>
                  </div>
                </div>

                {doc.error_msg && (
                  <p className="text-xs text-destructive truncate" title={doc.error_msg}>{doc.error_msg}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          !uploading && (
            <p className="text-sm text-muted-foreground text-center py-4">{t('noDocuments')}</p>
          )
        )}
      </div>

      {/* ── Right: review panel ── */}
      {selectedDoc && (
        <div className="flex-1 min-w-0 border-l border-border pl-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold truncate">{selectedDoc.filename}</h2>
          </div>

          {selectedDoc.status !== 'extracted' ? (
            <p className="text-sm text-muted-foreground">{t('notExtracted')}</p>
          ) : docResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tR('loading')}</p>
          ) : (
            <>
              {/* Sub-form tabs for consolidated 1099 */}
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

              {result && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="font-medium uppercase">{result.form_type}</span>
                      <span className="text-muted-foreground text-xs">
                        {tR('avgConfidence', { pct: (result.confidence * 100).toFixed(0) })}
                      </span>
                      {result.user_verified && (
                        <span className="text-xs text-green-600 font-medium">{tR('verified')}</span>
                      )}
                    </div>
                    <Button size="sm" onClick={() => handleSave(result)} disabled={saving[rid] || !hasEdits}>
                      {saving[rid] ? tR('saving') : tR('saveChanges')}
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(result.data).map(([field, value]) => {
                      const conf = result.field_confidences[field] ?? 1
                      const current = resultEdits[field] !== undefined ? resultEdits[field] : String(value ?? '')
                      return (
                        <div key={field} className={`border rounded-md p-2.5 ${confidenceBorder(conf)}`}>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium capitalize text-muted-foreground">
                              {field.replace(/_/g, ' ')}
                            </label>
                            {conf < 0.8 && (
                              <span className="text-[10px] text-muted-foreground">{(conf * 100).toFixed(0)}%</span>
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
              )}
            </>
          )}

          {/* Original file preview */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground truncate">
              {selectedDoc.filename}
            </div>
            {selectedDoc.file_type === 'pdf' ? (
              <iframe
                src={documents.previewUrl(selectedDoc.id)}
                className="w-full h-[800px]"
                title={selectedDoc.filename}
              />
            ) : (
              <img
                src={documents.previewUrl(selectedDoc.id)}
                alt={selectedDoc.filename}
                className="w-full object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
