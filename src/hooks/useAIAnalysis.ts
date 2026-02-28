import { useCallback, useRef, useState } from 'react'

export interface AIAnalysis {
  interpretation: string   // 문장 전체 한국어 해석
  usage: string            // 선택 단어/표현의 사용 맥락
  relatedPhrases: string   // 유사 표현
}

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined

export function useAIAnalysis() {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cacheRef = useRef<Map<string, AIAnalysis>>(new Map())

  const analyze = useCallback(async (sentence: string, word: string, wordTranslation?: string) => {
    if (!API_KEY) { setError('no_key'); return }
    const cacheKey = `${sentence}||${word}`
    if (cacheRef.current.has(cacheKey)) {
      setAnalysis(cacheRef.current.get(cacheKey)!)
      return
    }
    setLoading(true)
    setError(null)
    setAnalysis(null)
    try {
      const prompt = `한국인 영어 학습자를 위해 아래 영어 문장과 선택된 단어/표현을 분석해줘.

문장: "${sentence}"
선택된 단어/표현: "${word}"${wordTranslation ? ` (한국어 뜻: ${wordTranslation})` : ''}

아래 JSON 형식으로만 답해줘 (마크다운 코드블록 없이, 순수 JSON만):
{
  "interpretation": "이 문장 전체의 자연스러운 한국어 해석 (1~2문장)",
  "usage": "${word}이(가) 이 맥락에서 어떻게 쓰이는지 설명 (1~2문장, 한국어)",
  "relatedPhrases": "비슷한 표현 2~3개를 짧은 한국어 설명과 함께 (예: give in(굴복하다), surrender(항복하다))"
}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json() as { content: { text: string }[] }
      const text = data.content?.[0]?.text ?? ''
      const parsed = JSON.parse(text) as AIAnalysis
      cacheRef.current.set(cacheKey, parsed)
      setAnalysis(parsed)
    } catch {
      setError('분석 실패 — API 키 또는 네트워크를 확인하세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    setAnalysis(null)
    setError(null)
  }, [])

  return { analysis, loading, error, analyze, clear, hasKey: !!API_KEY }
}
