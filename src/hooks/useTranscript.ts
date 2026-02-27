import { useState } from 'react'
import { IS_EXT } from '../lib/env'

export interface TranscriptLine {
  start: number // seconds
  dur: number
  text: string
}

export interface TranscriptLanguage {
  code: string
  name: string
  isAuto?: boolean
}

export interface TranscriptResult {
  lines: TranscriptLine[]
  languages: TranscriptLanguage[]
  selectedLang: string
  error?: string
}

export function useTranscript() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(videoId: string, lang = 'en'): Promise<TranscriptResult | null> {
    setLoading(true)
    setError(null)
    try {
      let result: TranscriptResult

      if (IS_EXT) {
        // 확장 모드: content script가 YouTube 페이지에서 직접 fetch
        result = await new Promise((resolve, reject) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) return reject(new Error('YouTube 탭을 찾을 수 없어요.'))
            chrome.tabs.sendMessage(
              tabs[0].id,
              { type: 'YT_GET_TRANSCRIPT', videoId, lang },
              (response) => {
                if (chrome.runtime.lastError)
                  return reject(new Error(chrome.runtime.lastError.message))
                resolve(response as TranscriptResult)
              },
            )
          })
        })
      } else {
        // 웹 모드: Cloudflare Pages Function 프록시
        const res = await fetch(
          `/api/transcript?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`,
        )
        result = (await res.json()) as TranscriptResult
      }

      if (result.error && result.lines.length === 0) {
        setError(result.error)
        return null
      }
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, load }
}
