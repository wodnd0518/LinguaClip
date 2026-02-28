import { useRef, useState } from 'react'

export function useTranslation() {
  const [translation, setTranslation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const cache = useRef<Map<string, string>>(new Map())

  async function translate(text: string) {
    const key = text.trim()
    if (!key) return

    if (cache.current.has(key)) {
      setTranslation(cache.current.get(key)!)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(key)}&langpair=en|ko`,
      )
      const data = await res.json()
      const result: string = data.responseData?.translatedText ?? ''
      // MyMemory가 할당량 초과 시 에러 메시지를 그대로 반환하는 경우 처리
      if (!result || result.startsWith('MYMEMORY WARNING')) {
        setTranslation(null)
        return
      }
      cache.current.set(key, result)
      setTranslation(result)
    } catch {
      setTranslation(null)
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setTranslation(null)
  }

  return { translation, loading, translate, clear }
}
