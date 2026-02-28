import { useCallback, useEffect, useState } from 'react'
import { IS_EXT } from '../lib/env'

const STORAGE_KEY = 'anthropic_api_key'
// 빌드 타임 env 변수 (설정돼 있으면 우선 사용)
const ENV_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined

export function useAPIKey() {
  const [apiKey, setApiKeyState] = useState<string | null>(ENV_KEY || null)
  const [loading, setLoading] = useState(!ENV_KEY) // env 키 있으면 로딩 불필요

  useEffect(() => {
    if (ENV_KEY) return // 빌드 타임 키 우선
    if (IS_EXT) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        setApiKeyState((result[STORAGE_KEY] as string) || null)
        setLoading(false)
      })
    } else {
      setApiKeyState(localStorage.getItem(STORAGE_KEY))
      setLoading(false)
    }
  }, [])

  const saveKey = useCallback((key: string) => {
    const trimmed = key.trim()
    if (IS_EXT) {
      chrome.storage.local.set({ [STORAGE_KEY]: trimmed })
    } else {
      localStorage.setItem(STORAGE_KEY, trimmed)
    }
    setApiKeyState(trimmed || null)
  }, [])

  const clearKey = useCallback(() => {
    if (IS_EXT) {
      chrome.storage.local.remove(STORAGE_KEY)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
    setApiKeyState(null)
  }, [])

  return { apiKey, loading, saveKey, clearKey }
}
