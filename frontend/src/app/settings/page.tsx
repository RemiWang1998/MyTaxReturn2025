'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiKeys } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/settings/language-toggle'

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic', defaultModel: 'claude-opus-4-6', keyPlaceholder: 'sk-ant-…' },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o', keyPlaceholder: 'sk-…' },
  { value: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', keyPlaceholder: 'AIza…' },
]

type Status = 'idle' | 'testing' | 'saving' | 'ok' | 'error'

function getCurrentLocale() {
  if (typeof document === 'undefined') return 'en'
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)
  return match ? match[1] : 'en'
}

export default function SettingsPage() {
  const t = useTranslations('settings')
  const [keys, setKeys] = useState<{ provider: string; model_name: string }[]>([])
  const [form, setForm] = useState({ provider: 'anthropic', api_key: '', model_name: 'claude-opus-4-6' })
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [locale, setLocale] = useState('en')

  const load = () => apiKeys.list().then(setKeys)
  useEffect(() => {
    load()
    setLocale(getCurrentLocale())
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus('testing')
    setErrorMsg('')
    try {
      const res = await apiKeys.test(form)
      if (!res.ok) {
        setStatus('error')
        setErrorMsg(res.error ?? 'Test failed')
        return
      }
      setStatus('saving')
      await apiKeys.create(form)
      setForm((f) => ({ ...f, api_key: '' }))
      await load()
      setStatus('ok')
    } catch (err) {
      setStatus('error')
      setErrorMsg(String(err))
    }
  }

  async function handleDelete(provider: string) {
    await apiKeys.delete(provider)
    load()
  }

  const busy = status === 'testing' || status === 'saving'

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {keys.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">{t('savedKeys')}</h2>
          <div className="space-y-1">
            {keys.map((k) => (
              <div
                key={k.provider}
                className="flex items-center gap-3 px-3 py-2 border border-border rounded-md text-sm"
              >
                <span className="font-medium capitalize flex-1">{k.provider}</span>
                <span className="text-muted-foreground text-xs">{k.model_name}</span>
                <Button variant="destructive" size="xs" onClick={() => handleDelete(k.provider)}>
                  {t('remove')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <h2 className="text-sm font-medium">{t('addKey')}</h2>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t('provider')}</label>
          <select
            value={form.provider}
            onChange={(e) => {
              const p = PROVIDERS.find((x) => x.value === e.target.value)!
              setForm((f) => ({ ...f, provider: e.target.value, model_name: p.defaultModel }))
            }}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t('model')}</label>
          <input
            type="text"
            value={form.model_name}
            onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. claude-opus-4-6"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t('apiKey')}</label>
          <input
            type="password"
            value={form.api_key}
            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={PROVIDERS.find((p) => p.value === form.provider)?.keyPlaceholder ?? '…'}
            required
          />
        </div>

        {status === 'error' && <p className="text-sm text-destructive">{errorMsg}</p>}
        {status === 'ok' && <p className="text-sm text-green-600">{t('saved')}</p>}

        <Button type="submit" disabled={busy}>
          {status === 'testing' ? t('testing') : status === 'saving' ? t('saving') : t('testSave')}
        </Button>
      </form>

      <div className="border-t border-border pt-6">
        <h2 className="text-sm font-medium mb-4">{t('language')}</h2>
        <LanguageToggle current={locale} label={t('languageLabel')} />
      </div>
    </div>
  )
}
