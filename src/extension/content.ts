// Content script — YouTube 페이지에 주입됨
// 자막 이력 추적 + 플레이어 제어 브릿지

// ── 자막 이력 ─────────────────────────────────────────────
interface SubtitleEntry { text: string; time: number }
const subtitleHistory: SubtitleEntry[] = []
let lastCaptionText = ''
let shadowLoopTimer: ReturnType<typeof setInterval> | null = null

/**
 * YouTube 자동자막 병합 — 점진적 표시 방식 대응
 * 뒤 chunk에 포함된 앞 chunk 제거 → suffix-prefix 겹침 제거 후 병합
 */
function mergeSubtitleChunks(chunks: string[]): string {
  const trimmed = chunks.map((c) => c.trim()).filter(Boolean)
  if (trimmed.length === 0) return ''
  if (trimmed.length === 1) return trimmed[0]

  const filtered = trimmed.filter((chunk, i) => {
    const later = trimmed.slice(i + 1)
    return !later.some((l) => l.toLowerCase().includes(chunk.toLowerCase()))
  })
  const deduped = filtered.length > 0 ? filtered : [trimmed[trimmed.length - 1]]
  if (deduped.length === 1) return deduped[0]

  let result = deduped[0]
  for (let i = 1; i < deduped.length; i++) {
    const next = deduped[i]
    if (result.toLowerCase().includes(next.toLowerCase())) continue
    let overlapLen = 0
    const maxOverlap = Math.min(result.length, next.length, 120)
    for (let len = maxOverlap; len >= 4; len--) {
      if (result.slice(-len).toLowerCase() === next.slice(0, len).toLowerCase()) {
        overlapLen = len; break
      }
    }
    result = overlapLen > 0 ? result + next.slice(overlapLen) : result + ' ' + next
  }
  return result.replace(/\s+/g, ' ').trim()
}

function getCurrentSubtitle(): string {
  return Array.from(document.querySelectorAll('.ytp-caption-segment'))
    .map((el) => el.textContent ?? '').join(' ').trim()
}
function getVideo(): HTMLVideoElement | null {
  return document.querySelector('video.html5-main-video')
}
function stopShadowLoop() {
  if (shadowLoopTimer) { clearInterval(shadowLoopTimer); shadowLoopTimer = null }
}

function onCaptionChange() {
  const text = getCurrentSubtitle()
  if (!text || text === lastCaptionText) return
  lastCaptionText = text
  const time = getVideo()?.currentTime ?? 0
  subtitleHistory.push({ text, time })
  if (subtitleHistory.length > 60) subtitleHistory.shift()
}

function setupCaptionObserver() {
  const player = document.querySelector('#movie_player')
  if (!player) { setTimeout(setupCaptionObserver, 1000); return }
  new MutationObserver(onCaptionChange).observe(player, { childList: true, subtree: true })
}
setupCaptionObserver()

// ── 메시지 리스너 ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'YT_GET_INFO') {
    const video = getVideo()
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
    const video = getVideo()
    if (video) { video.currentTime = message.seconds as number; sendResponse({ ok: true }) }
    else sendResponse({ ok: false })
    return true
  }

  if (message.type === 'YT_PLAY') {
    const video = getVideo()
    if (video?.paused) video.play()
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'YT_GET_SUBTITLE') {
    sendResponse({ text: getCurrentSubtitle() })
    return true
  }

  // 쉐도잉: from ~ to 구간 무한 반복
  if (message.type === 'YT_START_SHADOW') {
    const from = message.from as number
    const to = message.to as number
    stopShadowLoop()
    const v = getVideo()
    if (!v) { sendResponse({ ok: false }); return true }
    v.currentTime = from
    v.play()
    // 0.1초 여유를 두고 from으로 점프 → 끊김 최소화
    shadowLoopTimer = setInterval(() => {
      const vid = getVideo()
      if (!vid || vid.paused) return
      if (vid.currentTime >= to - 0.05) vid.currentTime = from
    }, 80)
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'YT_STOP_SHADOW') {
    stopShadowLoop()
    const v = getVideo()
    if (v && !v.paused) v.pause()
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'YT_CAPTURE_SENTENCE') {
    const video = getVideo()
    const captureTime = video?.currentTime ?? 0
    stopShadowLoop() // 캡처 시 기존 쉐도잉 루프 종료

    const currentText = getCurrentSubtitle()
    if (currentText && currentText !== lastCaptionText) {
      lastCaptionText = currentText
      subtitleHistory.push({ text: currentText, time: captureTime })
    }
    if (video?.paused) video.play()

    setTimeout(() => {
      const v = getVideo()
      if (v && !v.paused) v.pause()
      const endTime = v?.currentTime ?? captureTime + 2

      const pool = subtitleHistory.filter((e) => e.time >= captureTime - 3)
      let sentenceStartIdx = 0
      for (let i = pool.length - 2; i >= 0; i--) {
        if (/[.!?]\s*$/.test(pool[i].text)) { sentenceStartIdx = i + 1; break }
      }
      const entries = pool.slice(sentenceStartIdx)
      const merged = mergeSubtitleChunks(entries.map((e) => e.text))

      // merged의 첫 3단어가 subtitleHistory에서 처음 등장한 시점을 startTime으로 사용
      // → 잘못된 문장 경계(중간 마침표 등)로 entries[0].time이 너무 늦어지는 문제 해결
      const startWords = merged.split(/\s+/).slice(0, 3).join(' ').toLowerCase()
      let startTime = Math.max(0, (pool[0]?.time ?? captureTime) - 0.5)
      for (let i = 0; i < subtitleHistory.length; i++) {
        if (subtitleHistory[i].text.toLowerCase().includes(startWords)) {
          startTime = Math.max(0, subtitleHistory[i].time - 0.5)
          break
        }
      }

      subtitleHistory.length = 0
      lastCaptionText = ''

      sendResponse({ text: merged || currentText, startTime, endTime })
    }, 1500)
    return true
  }
})
