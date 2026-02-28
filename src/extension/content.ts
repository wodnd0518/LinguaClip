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
  // 1차: 현재 페이지의 ytInitialPlayerResponse에서 captionTracks 직접 읽기
  // (이미 메모리에 있으므로 추가 fetch 불필요)
  type Track = { baseUrl: string; languageCode: string; name?: { simpleText?: string }; kind?: string }
  let tracks: Track[] | null = null

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipr = (window as any).ytInitialPlayerResponse
    const raw = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    if (Array.isArray(raw) && raw.length > 0) tracks = raw as Track[]
  } catch { /* ignore */ }

  // 2차: 페이지 fetch fallback
  if (!tracks) {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    })
    const html = await pageRes.text()
    const tracksMatch = html.match(/"captionTracks":(\[.*?\])/)
    if (!tracksMatch) return { lines: [], languages: [], error: '이 영상에는 자막이 없어요.' }
    tracks = JSON.parse(tracksMatch[1]) as Track[]
  }

  const track =
    tracks.find((t) => t.languageCode === lang) ??
    tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
    tracks[0]

  if (!track) return { lines: [], languages: [], error: '자막 트랙을 찾을 수 없어요.' }

  // baseUrl에 이미 fmt가 포함되어 있으면 추가하지 않음
  const captionUrl = track.baseUrl.includes('fmt=')
    ? track.baseUrl
    : `${track.baseUrl}&fmt=json3`

  const captionRes = await fetch(captionUrl)
  if (!captionRes.ok) return { lines: [], languages: [], error: `자막 fetch 실패 (${captionRes.status})` }

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
