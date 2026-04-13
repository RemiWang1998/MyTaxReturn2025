'use client'

import { useEffect, useRef, useState } from 'react'
import { documents, extraction } from '@/lib/api'
import type { Document } from '@/lib/api'
import { Button } from '@/components/ui/button'

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.zip'
const MAX_MB = 50

const statusColor: Record<Document['status'], string> = {
  uploaded: 'text-muted-foreground',
  extracting: 'text-yellow-600',
  extracted: 'text-green-600',
  error: 'text-destructive',
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [extracting, setExtracting] = useState<Record<string, boolean>>({})
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => documents.list().then(setDocs)
  useEffect(() => { load() }, [])

  async function handleFiles(files: File[]) {
    const valid = files.filter((f) => {
      if (f.size > MAX_MB * 1024 * 1024) {
        alert(`${f.name} exceeds ${MAX_MB} MB`)
        return false
      }
      return true
    })
    if (!valid.length) return
    setUploading(true)
    try {
      await documents.upload(valid)
      await load()
    } catch (err) {
      alert(String(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleExtract(docId: string) {
    setExtracting((e) => ({ ...e, [docId]: true }))
    try {
      await extraction.run(docId)
      await load()
    } catch (err) {
      alert(String(err))
    } finally {
      setExtracting((e) => ({ ...e, [docId]: false }))
    }
  }

  async function handleDelete(docId: string) {
    await documents.delete(docId)
    load()
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Documents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload W-2s, 1099s, or ZIP archives of your tax forms.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors select-none ${
          dragOver
            ? 'border-primary bg-accent'
            : 'border-border hover:border-primary/60 hover:bg-accent/40'
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
          {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, PNG, JPG, ZIP — max {MAX_MB} MB each
        </p>
      </div>

      {docs.length > 0 ? (
        <div className="space-y-1">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 px-3 py-2 border border-border rounded-md text-sm"
            >
              <span className="flex-1 truncate font-medium">{doc.filename}</span>
              <span className={`text-xs capitalize shrink-0 ${statusColor[doc.status]}`}>
                {doc.status}
              </span>
              {doc.error_msg && (
                <span
                  className="text-xs text-destructive truncate max-w-48"
                  title={doc.error_msg}
                >
                  {doc.error_msg}
                </span>
              )}
              {doc.status === 'uploaded' && (
                <Button
                  size="xs"
                  onClick={() => handleExtract(doc.id)}
                  disabled={extracting[doc.id]}
                >
                  {extracting[doc.id] ? 'Extracting…' : 'Extract'}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleDelete(doc.id)}
                title="Delete"
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      ) : (
        !uploading && (
          <p className="text-sm text-muted-foreground text-center py-4">No documents yet.</p>
        )
      )}
    </div>
  )
}
