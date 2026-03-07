// Service worker — 확장 아이콘 클릭 시 사이드 패널 열기
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error)
  }
})

interface CaptionTrack {
  baseUrl: string
  languageCode: string
  name?: { simpleText?: string }
  kind?: string
}

interface CaptionSegment {
  tStartMs: number
  dDurationMs?: number
  segs?: { utf8: string }[]
}

function parseJson3(events: CaptionSegment[]) {
  return (events ?? [])
    .filter((e) => (e.segs?.length ?? 0) > 0)
    .map((e) => ({
      start: e.tStartMs / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text: (e.segs ?? [])
        .map((s) => s.utf8)
        .join('')
        .replace(/\n/g, ' ')
        .trim(),
    }))
    .filter((l) => l.text)
}

// Service worker에는 DOMParser 없음 → regex로 XML 파싱
function parseXmlCaptions(xml: string): { start: number; dur: number; text: string }[] {
  const lines: { start: number; dur: number; text: string }[] = []
  const re = /<text[^>]+start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const text = m[3]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#\d+;/g, '')
      .replace(/\n/g, ' ').trim()
    if (text) lines.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]), text })
  }
  return lines
}

// YT_GET_TRANSCRIPT 처리
// 구조: executeScript(MAIN world)로 captionTracks URL 정보만 읽기
//       → background에서 직접 fetch (YouTube 서비스 워커 우회)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'YT_GET_TRANSCRIPT') return false

  const videoId = message.videoId as string
  const lang = (message.lang as string | undefined) ?? 'en'

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) {
      sendResponse({ error: 'YouTube 탭을 찾을 수 없어요.', lines: [] })
      return
    }

    try {
      // ── Step 1: captionTracks 정보만 읽기 (fetch 없음) ──
      const scriptResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [videoId],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        func: (_vid: string) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipr = (window as any).ytInitialPlayerResponse
            const raw = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
            if (Array.isArray(raw) && raw.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return raw.map((t: any) => ({
                baseUrl: t.baseUrl as string,
                languageCode: t.languageCode as string,
                name: t.name as { simpleText?: string } | undefined,
                kind: t.kind as string | undefined,
              }))
            }
          } catch { /* ignore */ }
          return null
        },
      })

      let tracks = scriptResult[0]?.result as CaptionTrack[] | null

      // ── Step 2: tracks 없으면 background에서 timedtext list API 호출 ──
      if (!tracks) {
        const listRes = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&type=list`)
        if (listRes.ok) {
          const xml = await listRes.text()
          const parsed: CaptionTrack[] = []
          const re = /<track\b([^>]*)>/g
          let m: RegExpExecArray | null
          while ((m = re.exec(xml)) !== null) {
            const attr = (name: string) => m![1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
            const langCode = attr('lang_code')
            if (!langCode) continue
            const kind = attr('kind') || undefined
            const name = attr('name')
            const langOriginal = attr('lang_original') || langCode
            const baseUrl =
              `https://www.youtube.com/api/timedtext?v=${videoId}` +
              `&lang=${encodeURIComponent(langCode)}` +
              (kind ? `&kind=${kind}` : '') +
              (name ? `&name=${encodeURIComponent(name)}` : '')
            parsed.push({ baseUrl, languageCode: langCode, name: { simpleText: langOriginal }, kind })
          }
          if (parsed.length > 0) tracks = parsed
        }
      }

      if (!tracks || tracks.length === 0) {
        sendResponse({ error: '이 영상에는 자막이 없어요.', lines: [] })
        return
      }

      // ── Step 3: 언어 선택 ──
      const track =
        tracks.find((t) => t.languageCode === lang) ??
        tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
        tracks[0]

      // ── Step 4: background에서 직접 fetch (YouTube 서비스 워커 우회) ──
      const base =
        `https://www.youtube.com/api/timedtext?v=${videoId}` +
        `&lang=${encodeURIComponent(track.languageCode)}`
      const kindParam = track.kind ? `&kind=${track.kind}` : ''

      const primaryUrl = track.baseUrl.includes('fmt=')
        ? track.baseUrl
        : `${track.baseUrl}&fmt=json3`

      const urlsToTry: [string, boolean][] = [
        // [url, isJson3]
        [primaryUrl, true],
        [`${base}${kindParam}&fmt=json3`, true],
        [`${base}&fmt=json3`, true],
        [`${base}${kindParam}`, false],   // XML fallback
        [`${base}`, false],
      ]

      let lines: { start: number; dur: number; text: string }[] | null = null

      for (const [url, isJson3] of urlsToTry) {
        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const text = await res.text()
          if (!text.trim()) continue
          console.log('[LC BG] ✓', url.replace('https://www.youtube.com/api/timedtext?', '').slice(0, 80))
          lines = isJson3
            ? parseJson3((JSON.parse(text) as { events: CaptionSegment[] }).events)
            : parseXmlCaptions(text)
          break
        } catch { continue }
      }

      if (!lines || lines.length === 0) {
        sendResponse({ error: '자막을 불러올 수 없어요. 이 영상에는 자막이 없거나 접근이 제한되어 있어요.', lines: [] })
        return
      }

      sendResponse({
        lines,
        languages: tracks.map((t) => ({
          code: t.languageCode,
          name: t.name?.simpleText ?? t.languageCode,
          isAuto: t.kind === 'asr',
        })),
        selectedLang: track.languageCode,
      })
    } catch (e) {
      sendResponse({ error: String(e), lines: [] })
    }
  })

  return true // 비동기 응답
})
