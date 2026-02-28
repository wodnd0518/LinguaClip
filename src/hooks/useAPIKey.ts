import { useCallback, useEffect, useState } from 'react'
import { IS_EXT } from '../lib/env'

export type AIProvider = 'anthropic' | 'openai'

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
}

export const PROVIDER_KEY_PREFIX: Record<AIProvider, string> = {
  anthropic: 'sk-ant',
  openai: 'sk-',
}

const STORAGE_PROVIDER = 'ai_provider'
const STORAGE_KEY: Record<AIProvider, string> = {
  anthropic: 'anthropic_api_key',
  openai: 'openai_api_key',
}

// 빌드 타임 env 변수 (있으면 우선 사용)
const ENV_KEYS: Record<AIProvider, string | undefined> = {
  anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined,
  openai: import.meta.env.VITE_OPENAI_API_KEY as string | undefined,
}

async function storageGet(keys: string[]): Promise<Record<string, string>> {
  if (IS_EXT) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r as Record<string, string>)))
  }
  return Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k) ?? '']))
}

function storageSet(data: Record<string, string>) {
  if (IS_EXT) {
    chrome.storage.local.set(data)
  } else {
    Object.entries(data).forEach(([k, v]) => v ? localStorage.setItem(k, v) : localStorage.removeItem(k))
  }
}

function storageRemove(key: string) {
  if (IS_EXT) {
    chrome.storage.local.remove(key)
  } else {
    localStorage.removeItem(key)
  }
}

export function useAPIKey() {
  const [provider, setProviderState] = useState<AIProvider>('anthropic')
  const [keys, setKeys] = useState<Record<AIProvider, string | null>>({ anthropic: null, openai: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    storageGet([STORAGE_PROVIDER, STORAGE_KEY.anthropic, STORAGE_KEY.openai]).then((result) => {
      setProviderState((result[STORAGE_PROVIDER] as AIProvider) || 'anthropic')
      setKeys({
        anthropic: ENV_KEYS.anthropic || result[STORAGE_KEY.anthropic] || null,
        openai: ENV_KEYS.openai || result[STORAGE_KEY.openai] || null,
      })
      setLoading(false)
    })
  }, [])

  const setProvider = useCallback((p: AIProvider) => {
    setProviderState(p)
    storageSet({ [STORAGE_PROVIDER]: p })
  }, [])

  const saveKey = useCallback((p: AIProvider, key: string) => {
    const trimmed = key.trim()
    storageSet({ [STORAGE_KEY[p]]: trimmed })
    setKeys((prev) => ({ ...prev, [p]: trimmed || null }))
  }, [])

  const clearKey = useCallback((p: AIProvider) => {
    storageRemove(STORAGE_KEY[p])
    setKeys((prev) => ({ ...prev, [p]: null }))
  }, [])

  return {
    provider,
    setProvider,
    keys,
    activeKey: keys[provider],
    saveKey,
    clearKey,
    loading,
  }
}
