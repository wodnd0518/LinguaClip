import { useCallback, useEffect, useState } from 'react'
import { IS_EXT } from '../lib/env'

const STORAGE_KEY = 'openai_api_key'
const ENV_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined

async function storageGet(key: string): Promise<string> {
  if (IS_EXT) {
    return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve((r[key] as string) ?? '')))
  }
  return localStorage.getItem(key) ?? ''
}

function storageSet(key: string, value: string) {
  if (IS_EXT) {
    chrome.storage.local.set({ [key]: value })
  } else {
    value ? localStorage.setItem(key, value) : localStorage.removeItem(key)
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
  const [apiKey, setApiKeyState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    storageGet(STORAGE_KEY).then((stored) => {
      setApiKeyState(ENV_KEY || stored || null)
      setLoading(false)
    })
  }, [])

  const saveKey = useCallback((key: string) => {
    const trimmed = key.trim()
    storageSet(STORAGE_KEY, trimmed)
    setApiKeyState(trimmed || null)
  }, [])

  const clearKey = useCallback(() => {
    storageRemove(STORAGE_KEY)
    setApiKeyState(null)
  }, [])

  return { apiKey, saveKey, clearKey, loading }
}
