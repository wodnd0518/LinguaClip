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
      if (IS_EXT) {
        // 확장 모드: background service worker가 scripting.executeScript(MAIN world)로
        // YouTube 페이지 context에서 fetch → 사용자 쿠키 자동 포함
        const result = await new Promise<TranscriptResult>((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'YT_GET_TRANSCRIPT', videoId, lang },
            (response) => {
              if (chrome.runtime.lastError)
                return reject(new Error(chrome.runtime.lastError.message))
              resolve(response as TranscriptResult)
            },
          )
        })
        if (result.error) { setError(result.error); return null }
        return result
      }

      // 웹 모드: YouTube는 Cloudflare IP와 cross-origin 브라우저 요청 모두 차단
      // → 자동 불러오기 불가. 확장 프로그램 or 수동 붙여넣기 안내
      setError(
        'YouTube 자막을 자동으로 불러올 수 없어요. ' +
        'LinguaClip 확장 프로그램을 설치하거나, YouTube에서 스크립트를 복사해 아래에 붙여넣으세요.',
      )
      return null
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, load }
}
