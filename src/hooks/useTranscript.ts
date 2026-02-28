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

// srv1: <text start="1.23" dur="2.34">...</text>
// srv3: <p t="1230" d="2340"><s>...</s></p>
function parseXml(xml: string): TranscriptLine[] {
  const clean = (s: string) =>
    s.replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n/g, ' ').trim()

  let m: RegExpExecArray | null

  const srv1 = /<text[^>]*\bstart="([\d.]+)"[^>]*\bdur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  const srv1Lines: TranscriptLine[] = []
  while ((m = srv1.exec(xml)) !== null) {
    const text = clean(m[3])
    if (text) srv1Lines.push({ start: Number(m[1]), dur: Number(m[2]), text })
  }
  if (srv1Lines.length > 0) return srv1Lines

  const srv3 = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  const srv3Lines: TranscriptLine[] = []
  while ((m = srv3.exec(xml)) !== null) {
    const tM = /\bt="(\d+)"/.exec(m[1])
    const dM = /\bd="(\d+)"/.exec(m[1])
    if (!tM || !dM) continue
    const text = clean(m[2])
    if (text) srv3Lines.push({ start: Number(tM[1]) / 1000, dur: Number(dM[1]) / 1000, text })
  }
  return srv3Lines
}

interface CaptionSegment {
  tStartMs: number
  dDurationMs?: number
  segs?: { utf8: string }[]
}

function parseJson3(events: CaptionSegment[]): TranscriptLine[] {
  return (events ?? [])
    .filter((e) => (e.segs?.length ?? 0) > 0)
    .map((e) => ({
      start: e.tStartMs / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text: (e.segs ?? []).map((s) => s.utf8).join('').replace(/\n/g, ' ').trim(),
    }))
    .filter((l) => l.text)
}

async function fetchCaptionFromBrowser(captionUrl: string): Promise<TranscriptLine[]> {
  // 브라우저가 직접 YouTube caption URL을 fetch
  // (사용자 IP + YouTube 쿠키 → 서버 IP 차단 우회)
  const res = await fetch(captionUrl)
  if (!res.ok) throw new Error(`자막 URL 응답 오류 (${res.status})`)

  const text = (await res.text()).trim()
  if (!text) throw new Error('자막 응답이 비어있어요.')

  if (text.startsWith('{')) {
    const data = JSON.parse(text) as { events: CaptionSegment[] }
    const lines = parseJson3(data.events)
    if (lines.length > 0) return lines
    throw new Error('json3 파싱 결과 없음')
  }

  if (text.startsWith('<')) {
    const lines = parseXml(text)
    if (lines.length > 0) return lines
    throw new Error(`XML 파싱 결과 없음: ${text.slice(0, 200)}`)
  }

  throw new Error(`알 수 없는 형식: ${text.slice(0, 100)}`)
}

export function useTranscript() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(videoId: string, lang = 'en'): Promise<TranscriptResult | null> {
    setLoading(true)
    setError(null)
    try {
      if (IS_EXT) {
        // 확장 모드: content script가 YouTube 페이지에서 직접 fetch
        const result = await new Promise<TranscriptResult>((resolve, reject) => {
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
        if (result.error) { setError(result.error); return null }
        return result
      }

      // 웹 모드 Step 1: 서버에서 caption URL 메타데이터 가져오기
      const metaRes = await fetch(
        `/api/transcript?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`,
      )
      const metaText = await metaRes.text()
      if (!metaText.trim()) {
        setError('서버 응답이 비어있어요.')
        return null
      }

      let meta: { captionUrl?: string; languages: TranscriptLanguage[]; selectedLang: string; error?: string }
      try {
        meta = JSON.parse(metaText)
      } catch {
        setError(`서버 응답 파싱 실패: ${metaText.slice(0, 100)}`)
        return null
      }

      if (meta.error) { setError(meta.error); return null }
      if (!meta.captionUrl) { setError('자막 URL을 가져오지 못했어요.'); return null }

      // 웹 모드 Step 2: 브라우저가 caption URL 직접 fetch
      const lines = await fetchCaptionFromBrowser(meta.captionUrl)

      return { lines, languages: meta.languages, selectedLang: meta.selectedLang }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }

  return { loading, error, load }
}
