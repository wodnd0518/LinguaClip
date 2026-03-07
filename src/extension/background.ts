// Service worker — 확장 아이콘 클릭 시 사이드 패널 열기
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error)
  }
})

// YT_GET_TRANSCRIPT: YouTube 페이지의 MAIN world에서 fetch 실행
// → same-origin + 사용자 쿠키가 자동 포함되어 자막 URL 접근 가능
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'YT_GET_TRANSCRIPT') return false

  const videoId = message.videoId as string
  const lang = (message.lang as string | undefined) ?? 'en'

  // 현재 활성 YouTube 탭 찾기
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) {
      sendResponse({ error: 'YouTube 탭을 찾을 수 없어요.', lines: [] })
      return
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN', // YouTube 페이지 JS context에서 실행 (쿠키 포함)
        args: [videoId, lang],
        func: async (vid: string, langCode: string) => {
          // ── 자막 파싱 ──
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

          // ── captionTracks 가져오기 ──
          type Track = {
            baseUrl: string
            languageCode: string
            name?: { simpleText?: string }
            kind?: string
          }
          let tracks: Track[] | null = null

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipr = (window as any).ytInitialPlayerResponse
            const raw = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
            if (Array.isArray(raw) && raw.length > 0) tracks = raw as Track[]
            console.log('[LC] ytInitialPlayerResponse tracks:', tracks?.length ?? 0)
          } catch { /* ignore */ }

          // Fallback: timedtext list API — ytInitialPlayerResponse보다 느리지만 안정적
          // (HTML 전체 fetch + 정규식보다 신뢰성 높음)
          if (!tracks) {
            try {
              const listRes = await fetch(
                `https://www.youtube.com/api/timedtext?v=${vid}&type=list`,
                { headers: { 'Accept-Language': 'en-US,en;q=0.9' } },
              )
              if (listRes.ok) {
                const xml = await listRes.text()
                const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml')
                const trackEls = Array.from(xmlDoc.querySelectorAll('track'))
                if (trackEls.length > 0) {
                  tracks = trackEls.map((el) => {
                    const langCode = el.getAttribute('lang_code') ?? ''
                    const name = el.getAttribute('name') ?? ''
                    const langOriginal = el.getAttribute('lang_original') ?? langCode
                    const kind = el.getAttribute('kind') ?? undefined
                    const baseUrl =
                      `https://www.youtube.com/api/timedtext?v=${vid}` +
                      `&lang=${encodeURIComponent(langCode)}` +
                      (kind ? `&kind=${kind}` : '') +
                      (name ? `&name=${encodeURIComponent(name)}` : '') +
                      `&fmt=json3`
                    return { baseUrl, languageCode: langCode, name: { simpleText: langOriginal }, kind }
                  })
                }
              }
            } catch { /* ignore */ }
          }

          if (!tracks) return { lines: [], languages: [], error: '이 영상에는 자막이 없어요.' }

          const track =
            tracks.find((t) => t.languageCode === langCode) ??
            tracks.find((t) => t.languageCode.startsWith(langCode.split('-')[0])) ??
            tracks[0]

          if (!track) return { lines: [], languages: [], error: '자막 트랙을 찾을 수 없어요.' }

          async function fetchRaw(url: string): Promise<string> {
            try {
              const res = await fetch(url)
              const text = res.ok ? await res.text() : ''
              console.log(`[LC] fetch ${res.status} len=${text.length}`, url.split('?')[1])
              return text
            } catch (e) {
              console.log('[LC] fetch error:', e, url.split('?')[1])
              return ''
            }
          }

          function parseXml(xml: string): CaptionSegment[] {
            const doc = new DOMParser().parseFromString(xml, 'text/xml')
            return Array.from(doc.querySelectorAll('text')).map((el) => ({
              tStartMs: parseFloat(el.getAttribute('start') ?? '0') * 1000,
              dDurationMs: parseFloat(el.getAttribute('dur') ?? '0') * 1000,
              segs: [{ utf8: el.textContent ?? '' }],
            }))
          }

          const captionUrl = track.baseUrl.includes('fmt=')
            ? track.baseUrl
            : `${track.baseUrl}&fmt=json3`

          const base = `https://www.youtube.com/api/timedtext?v=${vid}&lang=${encodeURIComponent(track.languageCode)}`
          const kindParam = track.kind ? `&kind=${track.kind}` : ''
          console.log('[LC] selected track:', track.languageCode, track.kind)

          // fmt=json3 시도 목록
          const json3Urls = [
            captionUrl,
            `${base}${kindParam}&fmt=json3`,
            `${base}&fmt=json3`,
          ]
          // fmt 없음 (XML) 시도 목록 — json3가 모두 빈 응답일 때 fallback
          const xmlUrls = [
            `${base}${kindParam}`,
            `${base}`,
          ]

          let text = ''
          let isXml = false

          for (const url of json3Urls) {
            text = await fetchRaw(url)
            if (text.trim()) break
          }
          if (!text.trim()) {
            for (const url of xmlUrls) {
              text = await fetchRaw(url)
              if (text.trim()) { isXml = true; break }
            }
          }

          if (!text.trim()) return { lines: [], languages: [], error: '자막을 불러올 수 없어요. 이 영상에는 자막이 없거나 접근이 제한되어 있어요.' }

          const events: CaptionSegment[] = isXml
            ? parseXml(text)
            : (JSON.parse(text) as { events: CaptionSegment[] }).events

          return {
            lines: parseJson3(events),
            languages: tracks.map((t) => ({
              code: t.languageCode,
              name: t.name?.simpleText ?? t.languageCode,
              isAuto: t.kind === 'asr',
            })),
            selectedLang: track.languageCode,
          }
        },
      })

      const result = results[0]?.result
      if (!result) {
        sendResponse({ error: '스크립트 실행 결과가 없어요.', lines: [] })
      } else {
        sendResponse(result)
      }
    } catch (e) {
      sendResponse({ error: String(e), lines: [] })
    }
  })

  return true // 비동기 응답
})
