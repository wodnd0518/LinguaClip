import { useRef, useState } from 'react'

export interface DictionaryEntry {
  word: string
  phonetic?: string
  audio?: string
  meanings: {
    partOfSpeech: string
    definitions: { definition: string; example?: string }[]
  }[]
}

type CacheValue = DictionaryEntry | 'not_found'

export function useDictionary() {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useRef<Map<string, CacheValue>>(new Map())

  async function lookup(word: string) {
    // 축약형 처리: "don't" → "do", "it's" → "it" 등은 그냥 전체로 조회하고 없으면 앞 부분만 재시도
    const key = word.toLowerCase().replace(/^'+|'+$/g, '') // 앞뒤 apostrophe 제거
    if (!key) return

    if (cache.current.has(key)) {
      const cached = cache.current.get(key)!
      if (cached === 'not_found') {
        setEntry(null)
        setError('단어를 찾을 수 없어요.')
      } else {
        setEntry(cached)
        setError(null)
      }
      return
    }

    setLoading(true)
    setError(null)
    setEntry(null)

    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`,
      )

      if (!res.ok) {
        // 축약형이면 apostrophe 앞 부분만 재시도 (e.g. "don't" → "don")
        if (key.includes("'")) {
          const base = key.split("'")[0]
          if (base && base !== key) {
            setLoading(false)
            lookup(base)
            return
          }
        }
        cache.current.set(key, 'not_found')
        setEntry(null)
        setError('단어를 찾을 수 없어요.')
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any[] = await res.json()
      const raw = data[0]

      const audio = raw.phonetics?.find(
        (p: { audio?: string }) => p.audio,
      )?.audio as string | undefined

      const parsed: DictionaryEntry = {
        word: raw.word,
        phonetic:
          raw.phonetic ??
          (raw.phonetics?.find((p: { text?: string }) => p.text)?.text as string | undefined),
        audio,
        meanings: (
          raw.meanings as {
            partOfSpeech: string
            definitions: { definition: string; example?: string }[]
          }[]
        )
          .slice(0, 3)
          .map((m) => ({
            partOfSpeech: m.partOfSpeech,
            definitions: m.definitions.slice(0, 2).map((d) => ({
              definition: d.definition,
              example: d.example,
            })),
          })),
      }

      cache.current.set(key, parsed)
      setEntry(parsed)
    } catch {
      setError('사전을 불러오는 데 실패했어요.')
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setEntry(null)
    setError(null)
  }

  return { entry, loading, error, lookup, clear }
}
