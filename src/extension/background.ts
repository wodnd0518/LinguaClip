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

          if (!tracks) {
            const pageRes = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
              headers: { 'Accept-Language': 'en-US,en;q=0.9' },
            })
            const html = await pageRes.text()
            const m = html.match(/"captionTracks":(\[.*?\])/)
            if (!m) return { lines: [], languages: [], error: '이 영상에는 자막이 없어요.' }
            tracks = JSON.parse(m[1]) as Track[]
          }

          const track =
            tracks.find((t) => t.languageCode === langCode) ??
            tracks.find((t) => t.languageCode.startsWith(langCode.split('-')[0])) ??
            tracks[0]

          if (!track) return { lines: [], languages: [], error: '자막 트랙을 찾을 수 없어요.' }

          const captionUrl = track.baseUrl.includes('fmt=')
            ? track.baseUrl
            : `${track.baseUrl}&fmt=json3`

          const captionRes = await fetch(captionUrl)
          if (!captionRes.ok) {
            return { lines: [], languages: [], error: `자막 fetch 실패 (${captionRes.status})` }
          }

          const text = await captionRes.text()
          if (!text.trim()) return { lines: [], languages: [], error: '자막 응답이 비어있어요.' }

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
