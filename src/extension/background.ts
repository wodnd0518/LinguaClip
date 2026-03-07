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

          // auth 파라미터 제거한 clean URL (fallback용)
          const cleanUrl =
            `https://www.youtube.com/api/timedtext?v=${vid}` +
            `&lang=${encodeURIComponent(track.languageCode)}` +
            (track.name?.simpleText ? `&name=${encodeURIComponent(track.name.simpleText)}` : '') +
            `&fmt=json3`

          const captionUrl = track.baseUrl.includes('fmt=')
            ? track.baseUrl
            : `${track.baseUrl}&fmt=json3`

          async function fetchText(url: string): Promise<string> {
            const res = await fetch(url)
            if (!res.ok) return ''
            return res.text()
          }

          let text = await fetchText(captionUrl)
          // baseUrl이 만료됐거나 빈 응답이면 clean URL로 재시도
          if (!text.trim() && captionUrl !== cleanUrl) {
            text = await fetchText(cleanUrl)
          }
          if (!text.trim()) return { lines: [], languages: [], error: '자막을 불러올 수 없어요. 영상에 자막이 없거나 제한된 영상일 수 있어요.' }

          const data: { events: CaptionSegment[] } = JSON.parse(text)

          return {
            lines: parseJson3(data.events),
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
