// Content script — YouTube 페이지에 주입됨
// 자막 이력 추적 + 플레이어 제어 브릿지

// ── 자막 이력 ─────────────────────────────────────────────
interface SubtitleEntry { text: string; time: number }
const subtitleHistory: SubtitleEntry[] = []
let lastCaptionText = ''
let shadowLoopTimer: ReturnType<typeof setInterval> | null = null

/**
 * 실제 영어 자막인지 확인 — 비ASCII 문자가 30% 초과면 YouTube UI 알림으로 판단하여 제외
 * (예: "영어 (자동 생성됨) 설정을 확인하려면 을 클릭하세요")
 */
function isSubtitleText(text: string): boolean {
  if (!text) return false
  const nonAscii = (text.match(/[^\x00-\x7F]/g) ?? []).length
  return nonAscii / text.length <= 0.3
}

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
  if (!isSubtitleText(text)) return   // YouTube UI 알림 텍스트 무시
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

    const rawCurrentText = getCurrentSubtitle()
    const currentText = isSubtitleText(rawCurrentText) ? rawCurrentText : ''
    if (currentText && currentText !== lastCaptionText) {
      lastCaptionText = currentText
      subtitleHistory.push({ text: currentText, time: captureTime })
    }
    if (video?.paused) video.play()

    setTimeout(() => {
      const v = getVideo()
      if (v && !v.paused) v.pause()
      const endTime = v?.currentTime ?? captureTime + 2

      // 8초로 확장 — 긴 문장의 시작(4~6초 전)도 포함
      const pool = subtitleHistory.filter((e) => e.time >= captureTime - 8)
      let sentenceStartIdx = 0
      for (let i = pool.length - 2; i >= 0; i--) {
        const text = pool[i].text
        const nextText = pool[i + 1]?.text.trim() ?? ''
        // 경계 조건 1: 마침표/느낌표/물음표 뒤 대문자로 시작
        const isPunctBoundary = /[.!?]\s*$/.test(text) && /^[A-Z]/.test(nextText)
        // 경계 조건 2: YouTube 자막 리셋 감지
        // Case A: 이전 텍스트와 무관한 새 텍스트 (완전히 다른 내용)
        // Case B: 새 텍스트가 이전 긴 텍스트의 PREFIX (같은 문장 처음으로 되감기)
        //   예) text="work, actually. So anyway, I ended up..."
        //       nextText="work, actually."  → text가 nextText로 시작 = 리셋
        const shortNext = nextText.toLowerCase().slice(0, Math.min(nextText.length, 20))
        const isReset = nextText.length > 0 &&
          nextText.length < text.length * 0.5 &&
          (
            !text.toLowerCase().includes(shortNext) ||           // Case A: 무관한 텍스트
            text.toLowerCase().startsWith(shortNext)             // Case B: 같은 문장 리셋
          )
        if (isPunctBoundary || isReset) {
          sentenceStartIdx = i + 1
          break
        }
      }
      const entries = pool.slice(sentenceStartIdx)
      const merged = mergeSubtitleChunks(entries.map((e) => e.text))

      // startTime: 클릭 시 화면에 보이던 자막(currentText)의 첫 2단어가
      // pool에서 처음 등장한 시점 → 실제 문장 시작에 가장 가까움
      // (pool 내부만 탐색해 오래된 타임스탬프 오용 방지)
      const anchorText = currentText || merged
      const anchorWords = anchorText
        .split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).slice(0, 2).join(' ').toLowerCase()
      let startTime = Math.max(0, (pool[0]?.time ?? captureTime) - 1.2)
      if (anchorWords) {
        for (let i = 0; i < pool.length; i++) {
          if (pool[i].time > captureTime) break // captureTime 이후 항목 제외
          if (pool[i].text.toLowerCase().includes(anchorWords)) {
            startTime = Math.max(0, pool[i].time - 1.2)
            break
          }
        }
      }

      subtitleHistory.length = 0
      lastCaptionText = ''

      sendResponse({ text: merged || currentText, startTime, endTime })
    }, 1500)
    return true
  }
})
