'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { documents, extraction } from '@/lib/api'
import type { Document, ExtractionResult } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { TransactionTable } from '@/components/documents/TransactionTable'

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
  const [deletingAll, setDeletingAll] = useState(false)
  const [confidences, setConfidences] = useState<Record<string, number>>({})
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // review panel
  const [selected, setSelected] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ExtractionResult[]>>({})
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [deletedFields, setDeletedFields] = useState<Record<string, Set<string>>>({})
  const [subIdx, setSubIdx] = useState(0)

  const [pageError, setPageError] = useState<string | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)

  // splitters
  const [listWidth, setListWidth] = useState(272)   // left column (doc list)
  const [viewerWidth, setViewerWidth] = useState(480) // right column (source viewer)
  const [viewerVisible, setViewerVisible] = useState(true)
  const listSplitter = useRef<{ startX: number; startWidth: number } | null>(null)
  const viewerSplitter = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (listSplitter.current) {
        const delta = e.clientX - listSplitter.current.startX
        setListWidth(Math.max(200, listSplitter.current.startWidth + delta))
      }
      if (viewerSplitter.current) {
        const delta = viewerSplitter.current.startX - e.clientX
        setViewerWidth(Math.max(300, viewerSplitter.current.startWidth + delta))
      }
    }
    function onUp() { listSplitter.current = null; viewerSplitter.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

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
      const extracted = all.filter((d) => d.status === 'extracted' || d.status === 'error')
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

  // When a doc that is still extracting is selected, fetch any already-committed
  // sub-form results so they appear immediately without waiting for full completion.
  useEffect(() => {
    if (!selected) return
    const doc = docs.find((d) => d.id === selected)
    if (doc?.status !== 'extracting') return
    extraction.results(selected).then((arr) => {
      if (arr.length > 0) setResults((prev) => ({ ...prev, [selected]: arr }))
    }).catch(() => {})
  }, [selected, docs])

  useEffect(() => {
    setConfidences((prev) => {
      const next = { ...prev }
      for (const [docId, arr] of Object.entries(results)) {
        if (arr.length === 0) delete next[docId]
        else next[docId] = Math.min(...arr.map((r) => r.confidence))
      }
      return next
    })
  }, [results])

  async function handleFiles(files: File[]) {
    const valid: File[] = []
    const oversized: string[] = []
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) oversized.push(f.name)
      else valid.push(f)
    }
    if (oversized.length) setPageError(`${oversized.join(', ')} exceeds ${MAX_MB} MB`)
    if (!valid.length) return
    setPageError(null)
    setUploading(true)
    try { await documents.upload(valid); await load() }
    catch (err) { setPageError(String(err)) }
    finally { setUploading(false) }
  }

  // Poll until none of the given doc IDs are still in "extracting" state, then do a full load.
  // While polling, eagerly fetch results for any extracting doc that is currently selected
  // so sub-form results appear as soon as each one is committed.
  async function pollUntilDone(docIds: string[]) {
    const ids = new Set(docIds)
    for (let i = 0; i < 120; i++) {
      await new Promise<void>((r) => setTimeout(r, 1500))
      const all = await documents.list()
      setDocs(all)
      // Fetch partial results for all still-extracting docs so sub-forms appear immediately
      const stillExtracting = all.filter((d) => ids.has(d.id) && d.status === 'extracting')
      await Promise.allSettled(
        stillExtracting.map(async (d) => {
          try {
            const arr = await extraction.results(d.id)
            if (arr.length > 0) setResults((prev) => ({ ...prev, [d.id]: arr }))
          } catch { /* ignore mid-extraction fetch errors */ }
        })
      )
      if (!all.some((d) => ids.has(d.id) && d.status === 'extracting')) break
    }
    await load()
  }

  async function handleExtract(docId: string) {
    setPageError(null)
    setExtracting((e) => ({ ...e, [docId]: true }))
    try { await extraction.run(docId); await pollUntilDone([docId]) }
    catch (err) { setPageError(String(err)) }
    finally { setExtracting((e) => ({ ...e, [docId]: false })) }
  }

  async function handleBatchExtract() {
    const ids = docs.filter((d) => d.status === 'uploaded').map((d) => d.id)
    if (!ids.length) return
    setBatchExtracting(true)
    setExtracting(Object.fromEntries(ids.map((id) => [id, true])))
    try { await Promise.allSettled(ids.map((id) => extraction.run(id))); await pollUntilDone(ids) }
    finally { setBatchExtracting(false); setExtracting({}) }
  }

  async function handleBatchReExtract() {
    const ids = docs.filter((d) => d.status === 'extracted' || d.status === 'error').map((d) => d.id)
    if (!ids.length) return
    setBatchReExtracting(true)
    setExtracting(Object.fromEntries(ids.map((id) => [id, true])))
    try { await Promise.allSettled(ids.map((id) => extraction.run(id))); await pollUntilDone(ids) }
    finally { setBatchReExtracting(false); setExtracting({}) }
  }

  async function handleDeleteAll() {
    if (!docs.length) return
    if (!confirmDeleteAll) { setConfirmDeleteAll(true); return }
    setConfirmDeleteAll(false)
    setDeletingAll(true)
    setSelected(null)
    try { await Promise.allSettled(docs.map((d) => documents.delete(d.id))); await load() }
    finally { setDeletingAll(false) }
  }

  async function handleBatchLowConfExtract() {
    const ids = docs
      .filter((d) => d.status === 'extracted' && (confidences[d.id] ?? 1) < LOW_CONF_THRESHOLD)
      .map((d) => d.id)
    if (!ids.length) return
    setBatchLowConfExtracting(true)
    setExtracting(Object.fromEntries(ids.map((id) => [id, true])))
    try { await Promise.allSettled(ids.map((id) => extraction.run(id))); await pollUntilDone(ids) }
    finally { setBatchLowConfExtracting(false); setExtracting({}) }
  }

  async function handleDocTypeChange(docId: string, value: string) {
    const doc_type = value === '' ? null : value
    await documents.updateDocType(docId, doc_type)
    setResults((r) => { const n = { ...r }; delete n[docId]; return n })
    setConfidences((c) => { const n = { ...c }; delete n[docId]; return n })
    await load()
  }

  async function handleDelete(docId: string) {
    if (selected === docId) setSelected(null)
    try { await documents.delete(docId) } catch { /* already gone */ }
    load()
  }

  function setEdit(resultId: string, field: string, value: string) {
    setEdits((e) => ({ ...e, [resultId]: { ...e[resultId], [field]: value } }))
  }

  function handleDeleteField(resultId: string, field: string) {
    setDeletedFields((d) => {
      const prev = d[resultId] ?? new Set<string>()
      return { ...d, [resultId]: new Set([...prev, field]) }
    })
    // Remove any pending edit for this field
    setEdits((e) => {
      if (!e[resultId]) return e
      const copy = { ...e[resultId] }
      delete copy[field]
      return { ...e, [resultId]: copy }
    })
  }

  async function handleDeleteSubform(result: ExtractionResult) {
    const docId = String(result.document_id)
    const rid = String(result.id)
    try {
      await extraction.deleteResult(rid)
      setResults((prev) => {
        const updated = (prev[docId] ?? []).filter((r) => String(r.id) !== rid)
        return { ...prev, [docId]: updated }
      })
      setSubIdx(0)
      setEdits((e) => { const n = { ...e }; delete n[rid]; return n })
      setDeletedFields((d) => { const n = { ...d }; delete n[rid]; return n })
    } catch (err) { setPageError(String(err)) }
  }

  async function handleSave(result: ExtractionResult) {
    const rid = String(result.id)
    setSaving((s) => ({ ...s, [rid]: true }))
    const deleted = deletedFields[rid] ?? new Set<string>()
    const merged = Object.fromEntries(
      Object.entries({ ...result.data, ...(edits[rid] ?? {}) })
        .filter(([field]) => !deleted.has(field))
    )
    // Edited fields are user-verified → confidence 1.0; others keep their stored value.
    const effectiveConfs: Record<string, number> = Object.fromEntries(
      Object.keys(merged).map((field) => [
        field,
        (edits[rid] ?? {})[field] !== undefined ? 1.0 : (result.field_confidences[field] ?? 1.0),
      ])
    )
    try {
      const updated = await extraction.update(rid, merged, effectiveConfs)
      setResults((prev) => {
        const docResults = prev[String(result.document_id)] ?? []
        return { ...prev, [String(result.document_id)]: docResults.map((r) => r.id === result.id ? updated : r) }
      })
      setEdits((e) => ({ ...e, [rid]: {} }))
      setDeletedFields((d) => { const n = { ...d }; delete n[rid]; return n })
    } catch (err) { setPageError(String(err)) }
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
  const resultDeleted = rid ? (deletedFields[rid] ?? new Set<string>()) : new Set<string>()
  const hasEdits = Object.keys(resultEdits).length > 0 || resultDeleted.size > 0

  // Live confidence: average of field confidences for non-deleted fields.
  // User-edited fields are treated as confidence 1.0.
  const displayedConfidence = (() => {
    if (!result) return 0
    const confs = Object.entries(result.field_confidences)
      .filter(([field]) => !resultDeleted.has(field))
      .map(([field, v]) => resultEdits[field] !== undefined ? 1 : v)
    return confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : result.confidence
  })()

  return (
    <div className="flex min-h-0">
      {/* ── Left: document list (hidden on narrow when a doc is selected) ── */}
      <div className={`shrink-0 space-y-4 pr-4 ${selectedDoc ? 'hidden xl:block' : 'block'}`} style={{ width: selectedDoc ? listWidth : undefined }}>
        <div>
          <h1 className="text-xl font-semibold">{t('heading')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>

        {/* Error banner */}
        {pageError && (
          <p role="alert" className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            {pageError}
          </p>
        )}

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
          {docs.length > 0 && (
            confirmDeleteAll ? (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-destructive">{t('deleteAllConfirm')}</span>
                <Button variant="destructive" size="xs" disabled={deletingAll} onClick={handleDeleteAll}>{t('deleteAllYes')}</Button>
                <Button variant="ghost" size="xs" onClick={() => setConfirmDeleteAll(false)}>{t('deleteAllCancel')}</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" disabled={deletingAll} onClick={handleDeleteAll}
                className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10">
                {deletingAll ? t('deletingAll') : t('deleteAll')}
              </Button>
            )
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
                    {(doc.status === 'extracted' || doc.status === 'error' || doc.status === 'extracting') && (
                      <Button variant="outline" size="xs" onClick={() => handleExtract(doc.id)} disabled={extracting[doc.id]}>
                        {extracting[doc.id] ? t('extracting') : t('reExtract')}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(doc.id)} title="Delete">✕</Button>
                  </div>
                </div>

                {doc.error_msg && (
                  <p className="text-xs text-destructive">{doc.error_msg}</p>
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

      {/* ── List / review splitter ── */}
      <div
        className={`items-center justify-center w-4 shrink-0 self-stretch cursor-col-resize group ${selectedDoc ? 'hidden xl:flex' : 'hidden'}`}
        onMouseDown={(e) => { listSplitter.current = { startX: e.clientX, startWidth: listWidth }; e.preventDefault() }}
      >
        <div className="w-px h-full bg-border group-hover:bg-primary/40 transition-colors" />
      </div>

      {/* ── Right: review panel ── */}
      {selectedDoc && (
        <div className="flex-1 min-w-0 xl:pl-2 space-y-4">
          <div className="flex items-center gap-3">
            <button
              className="xl:hidden text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(null)}
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold truncate">{selectedDoc.filename}</h2>
          </div>

          {/* On wide screens: review data left, PDF viewer right */}
          <div className="flex flex-col xl:flex-row xl:items-start">
            {/* Review data */}
            <div className="flex-1 min-w-0 space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={() => setViewerVisible((v) => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {viewerVisible ? 'Hide source doc' : 'Show source doc'}
                </button>
              </div>
              {selectedDoc.status === 'uploaded' || (selectedDoc.status === 'error' && docResults.length === 0) ? (
                <p className="text-sm text-muted-foreground">{t('notExtracted')}</p>
              ) : docResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tR('loading')}</p>
              ) : (
                <>
                  {/* Sub-form tabs for consolidated 1099 */}
                  {docResults.length > 1 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {docResults.map((r, i) => (
                        <div
                          key={r.id}
                          className={`flex items-center gap-1 rounded border transition-colors ${
                            subIdx === i
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'border-border text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          <button
                            onClick={() => setSubIdx(i)}
                            className="px-2.5 py-1 text-xs font-medium uppercase"
                          >
                            {r.form_type}
                          </button>
                          <button
                            onClick={() => handleDeleteSubform(r)}
                            title={`Remove ${r.form_type}`}
                            className="pr-2 text-[10px] text-muted-foreground hover:text-destructive leading-none"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {result && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm">
                          <span className="font-medium uppercase">{result.form_type}</span>
                          <span className="text-muted-foreground text-xs">
                            {tR('avgConfidence', { pct: (displayedConfidence * 100).toFixed(0) })}
                          </span>
                          {result.user_verified && (
                            <span className="text-xs text-green-600 font-medium">{tR('verified')}</span>
                          )}
                        </div>
                        <Button size="sm" onClick={() => handleSave(result)} disabled={saving[rid] || !hasEdits}>
                          {saving[rid] ? tR('saving') : tR('saveChanges')}
                        </Button>
                      </div>

                      {/* Scalar fields in a 2-column grid */}
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(result.data)
                          .filter(([field, value]) => field !== 'recipient_tin' && !Array.isArray(value) && !resultDeleted.has(field))
                          .map(([field, value]) => {
                            const conf = resultEdits[field] !== undefined ? 1 : (result.field_confidences[field] ?? 1)
                            const current = resultEdits[field] !== undefined ? resultEdits[field] : String(value ?? '')
                            return (
                              <div key={field} className={`border rounded-md p-2.5 ${confidenceBorder(conf)}`}>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-xs font-medium capitalize text-muted-foreground">
                                    {field.replace(/_/g, ' ')}
                                  </label>
                                  <div className="flex items-center gap-1">
                                    {conf < 0.8 && (
                                      <span className="text-[10px] text-muted-foreground">{(conf * 100).toFixed(0)}%</span>
                                    )}
                                    <button
                                      onClick={() => handleDeleteField(rid, field)}
                                      title="Delete field"
                                      className="text-[10px] text-muted-foreground hover:text-destructive leading-none"
                                    >✕</button>
                                  </div>
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

              {/* Transaction tables */}
              {result && Object.entries(result.data)
                .filter(([, value]) => Array.isArray(value))
                .map(([field, value]) => {
                  const conf = result.field_confidences[field] ?? 1
                  return (
                    <div key={field} className={`border rounded-md p-2.5 ${confidenceBorder(conf)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium capitalize text-muted-foreground">
                          {field.replace(/_/g, ' ')}
                        </label>
                        {conf < 0.8 && (
                          <span className="text-[10px] text-muted-foreground">{(conf * 100).toFixed(0)}%</span>
                        )}
                      </div>
                      <TransactionTable transactions={(value as Record<string, string | number | boolean | null>[]) ?? []} />
                    </div>
                  )
                })
              }
            </div>


            {/* Splitter — only visible in side-by-side layout */}
            {viewerVisible && (
              <div
                className="hidden xl:flex items-center justify-center w-4 shrink-0 self-stretch cursor-col-resize group"
                onMouseDown={(e) => {
                  viewerSplitter.current = { startX: e.clientX, startWidth: viewerWidth }
                  e.preventDefault()
                }}
              >
                <div className="w-px h-full bg-border group-hover:bg-primary/40 transition-colors" />
              </div>
            )}

            {/* Source document viewer */}
            {viewerVisible && (
              <div className="shrink-0 mt-4 xl:mt-0 space-y-2" style={{ ['--viewer-w' as string]: `${viewerWidth}px` }}>
                <h3 className="hidden xl:block text-sm font-medium text-muted-foreground">Source Document</h3>
                <div className="border border-border rounded-lg overflow-hidden w-full xl:[width:var(--viewer-w)]">
                  <div className="px-3 py-2 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground truncate">
                    {selectedDoc.filename}
                  </div>
                  {selectedDoc.file_type === 'pdf' ? (
                    <iframe
                      key={selectedDoc.id}
                      src={documents.previewUrl(selectedDoc.id)}
                      className="w-full h-[800px]"
                      title={selectedDoc.filename}
                    />
                  ) : (
                    <img
                      key={selectedDoc.id}
                      src={documents.previewUrl(selectedDoc.id)}
                      alt={selectedDoc.filename}
                      className="w-full object-contain"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
