import { useCallback, useRef, useState } from 'react'
import type { AIProvider } from './useAPIKey'

export interface AIAnalysis {
  interpretation: string   // 문장 전체 한국어 해석
  usage: string            // 선택 단어/표현의 사용 맥락
  relatedPhrases: string   // 유사 표현
  nativeExpressions: string // 원어민이 자주 쓰는 비슷한 뉘앙스의 구어 표현
}

function buildPrompt(sentence: string, word: string, wordTranslation?: string): string {
  return `한국인 영어 학습자를 위해 아래 영어 문장과 선택된 단어/표현을 분석해줘.

문장: "${sentence}"
선택된 단어/표현: "${word}"${wordTranslation ? ` (한국어 뜻: ${wordTranslation})` : ''}

아래 JSON 형식으로만 답해줘 (마크다운 코드블록 없이, 순수 JSON만):
{
  "interpretation": "이 문장 전체의 자연스러운 한국어 해석 (1~2문장)",
  "usage": "${word}이(가) 이 맥락에서 어떻게 쓰이는지 설명 (1~2문장, 한국어)",
  "relatedPhrases": "비슷한 표현 2~3개를 짧은 한국어 설명과 함께 (예: give in(굴복하다), surrender(항복하다))",
  "nativeExpressions": "원어민이 같은/비슷한 뉘앙스를 구어체로 표현할 때 자주 쓰는 표현 2~3개 (예: I'm stuffed.(배불러), I went overboard.(너무 지나쳤어)) 한국어 설명 포함"
}`
}

async function extractApiError(res: Response, prefix: string): Promise<never> {
  let detail = ''
  try {
    const body = await res.json() as Record<string, unknown>
    const msg = (body.error as Record<string, unknown>)?.message ?? body.message ?? JSON.stringify(body)
    detail = `: ${msg}`
  } catch { /* ignore */ }
  throw new Error(`${prefix} ${res.status}${detail}`)
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) await extractApiError(res, 'Claude')
  const data = await res.json() as { content: { text: string }[] }
  return data.content?.[0]?.text ?? ''
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) await extractApiError(res, 'OpenAI')
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512 },
      }),
    },
  )
  if (!res.ok) await extractApiError(res, 'Gemini')
  const data = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// 모델마다 JSON 형식이 다를 수 있으므로 모든 필드를 string으로 정규화
function toStr(val: unknown): string {
  if (typeof val === 'string') return val
  if (Array.isArray(val)) {
    return val.map((item) => {
      if (typeof item === 'string') return item
      if (typeof item === 'object' && item !== null) {
        // {phrase, description} / {word, meaning} 등 다양한 키 대응
        const entries = Object.values(item as Record<string, unknown>).filter(
          (v) => typeof v === 'string',
        ) as string[]
        return entries.length >= 2 ? `${entries[0]}(${entries[1]})` : entries.join(' ')
      }
      return String(item)
    }).join(', ')
  }
  if (typeof val === 'object' && val !== null) {
    return Object.values(val as Record<string, unknown>)
      .filter((v) => typeof v === 'string')
      .join(' ')
  }
  return String(val ?? '')
}

function normalizeAnalysis(raw: unknown): AIAnalysis {
  const r = raw as Record<string, unknown>
  return {
    interpretation: toStr(r.interpretation),
    usage: toStr(r.usage),
    relatedPhrases: toStr(r.relatedPhrases),
    nativeExpressions: toStr(r.nativeExpressions),
  }
}

export function useAIAnalysis(provider: AIProvider, apiKey: string | null) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cacheRef = useRef<Map<string, AIAnalysis>>(new Map())

  const analyze = useCallback(async (sentence: string, word: string, wordTranslation?: string) => {
    if (!apiKey) { setError('no_key'); return }
    const cacheKey = `${provider}||${sentence}||${word}`
    if (cacheRef.current.has(cacheKey)) {
      setAnalysis(cacheRef.current.get(cacheKey)!)
      return
    }
    setLoading(true)
    setError(null)
    setAnalysis(null)
    try {
      const prompt = buildPrompt(sentence, word, wordTranslation)
      const text = provider === 'anthropic'
        ? await callAnthropic(apiKey, prompt)
        : provider === 'gemini'
          ? await callGemini(apiKey, prompt)
          : await callOpenAI(apiKey, prompt)
      // 일부 모델은 마크다운 코드블록으로 감싸거나 필드를 객체/배열로 반환하므로 정규화
      const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
      const parsed = normalizeAnalysis(JSON.parse(cleaned))
      cacheRef.current.set(cacheKey, parsed)
      setAnalysis(parsed)
    } catch (e) {
      setError(e instanceof Error ? `분석 실패 — ${e.message}` : '분석 실패 — 네트워크를 확인하세요.')
    } finally {
      setLoading(false)
    }
  }, [provider, apiKey])

  const clear = useCallback(() => {
    setAnalysis(null)
    setError(null)
  }, [])

  return { analysis, loading, error, analyze, clear }
}
