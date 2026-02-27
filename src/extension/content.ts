// Content script — YouTube 페이지에 주입됨
// YouTube 네이티브 플레이어 + 자막과 사이드 패널 간 브릿지 역할

// ── 자막 파싱 ──────────────────────────────────────────────
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

async function fetchTranscript(videoId: string, lang: string) {
  // content script는 YouTube 페이지 컨텍스트에서 실행되므로 CORS 없이 fetch 가능
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  })
  const html = await pageRes.text()

  const tracksMatch = html.match(/"captionTracks":(\[.*?\])/)
  if (!tracksMatch) return { lines: [], languages: [], error: '이 영상에는 자막이 없어요.' }

  const tracks: {
    baseUrl: string
    languageCode: string
    name?: { simpleText?: string }
    kind?: string
  }[] = JSON.parse(tracksMatch[1])

  const track =
    tracks.find((t) => t.languageCode === lang) ??
    tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
    tracks[0]

  if (!track) return { lines: [], languages: [], error: '자막 트랙을 찾을 수 없어요.' }

  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`)
  const data: { events: CaptionSegment[] } = await captionRes.json()

  return {
    lines: parseJson3(data.events),
    languages: tracks.map((t) => ({
      code: t.languageCode,
      name: t.name?.simpleText ?? t.languageCode,
      isAuto: t.kind === 'asr',
    })),
    selectedLang: track.languageCode,
  }
}

// ── 메시지 리스너 ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'YT_GET_INFO') {
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video')
    const videoId = new URLSearchParams(location.search).get('v')
    const titleEl = document.querySelector<HTMLElement>(
      'ytd-watch-metadata #title h1, h1.ytd-video-primary-info-renderer',
    )
    sendResponse({
      videoId,
      currentTime: video?.currentTime ?? 0,
      duration: video?.duration ?? 0,
      paused: video ? video.paused : true,
      title: titleEl?.textContent?.trim() ?? document.title.replace(' - YouTube', ''),
    })
    return true
  }

  if (message.type === 'YT_SEEK') {
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video')
    if (video) {
      video.currentTime = message.seconds as number
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false })
    }
    return true
  }

  if (message.type === 'YT_GET_TRANSCRIPT') {
    const videoId =
      (message.videoId as string | undefined) ??
      new URLSearchParams(location.search).get('v') ??
      ''
    const lang = (message.lang as string | undefined) ?? 'en'

    if (!videoId) {
      sendResponse({ error: 'No video ID', lines: [] })
      return true
    }

    // 비동기로 자막 fetch 후 sendResponse 호출
    fetchTranscript(videoId, lang)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e), lines: [] }))

    return true // 비동기 응답을 위해 반드시 true 반환
  }
})
