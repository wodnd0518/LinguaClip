// Content script — YouTube 페이지에 주입됨
// 자막 이력 추적 + 플레이어 제어 브릿지

// ── 자막 이력 (문장 단위 캡처용) ─────────────────────────────
interface SubtitleEntry { text: string; time: number }
const subtitleHistory: SubtitleEntry[] = []
let lastCaptionText = ''

/**
 * YouTube 자동자막 병합 — 점진적 표시 방식 대응
 *
 * YouTube는 자막을 이렇게 표시함:
 *   1) "I quit my two jobs"
 *   2) "I quit my two jobs I vowed to hit YouTube"
 *   3) "the two jobs I vowed to hit YouTube as hard as I possibly could"
 *
 * → 뒤 chunk에 완전히 포함된 앞 chunk를 먼저 제거한 뒤,
 *   남은 chunk들의 suffix-prefix 겹침을 제거해 하나의 문장으로 병합.
 */
function mergeSubtitleChunks(chunks: string[]): string {
  const trimmed = chunks.map((c) => c.trim()).filter(Boolean)
  if (trimmed.length === 0) return ''
  if (trimmed.length === 1) return trimmed[0]

  // 1단계: 뒤에 오는 chunk에 이미 포함된 chunk 제거
  const filtered = trimmed.filter((chunk, i) => {
    const laterChunks = trimmed.slice(i + 1)
    return !laterChunks.some((later) =>
      later.toLowerCase().includes(chunk.toLowerCase()),
    )
  })
  const deduped = filtered.length > 0 ? filtered : [trimmed[trimmed.length - 1]]
  if (deduped.length === 1) return deduped[0]

  // 2단계: 남은 chunk들의 suffix-prefix 겹침 제거 후 병합
  let result = deduped[0]
  for (let i = 1; i < deduped.length; i++) {
    const next = deduped[i]
    if (result.toLowerCase().includes(next.toLowerCase())) continue
    let overlapLen = 0
    const maxOverlap = Math.min(result.length, next.length, 120)
    for (let len = maxOverlap; len >= 4; len--) {
      if (result.slice(-len).toLowerCase() === next.slice(0, len).toLowerCase()) {
        overlapLen = len
        break
      }
    }
    result = overlapLen > 0 ? result + next.slice(overlapLen) : result + ' ' + next
  }
  return result.replace(/\s+/g, ' ').trim()
}

function getCurrentSubtitle(): string {
  return Array.from(document.querySelectorAll('.ytp-caption-segment'))
    .map((el) => el.textContent ?? '')
    .join(' ')
    .trim()
}

function getVideo(): HTMLVideoElement | null {
  return document.querySelector('video.html5-main-video')
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
  if (!player) {
    setTimeout(setupCaptionObserver, 1000)
    return
  }
  new MutationObserver(onCaptionChange).observe(player, {
    childList: true,
    subtree: true,
  })
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
    if (video) {
      video.currentTime = message.seconds as number
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false })
    }
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

  if (message.type === 'YT_PLAY_SEGMENT') {
    // 지정 구간만 재생 후 정지 (쉐도잉용)
    const from = message.from as number
    const duration = (message.duration as number) ?? 7
    const video = getVideo()
    if (!video) { sendResponse({ ok: false }); return true }

    video.currentTime = from
    video.play()

    const endTime = from + duration
    const timer = setInterval(() => {
      const v = getVideo()
      if (!v || v.paused) { clearInterval(timer); return }
      if (v.currentTime >= endTime) {
        v.pause()
        clearInterval(timer)
      }
    }, 150)

    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'YT_CAPTURE_SENTENCE') {
    const video = getVideo()
    const captureTime = video?.currentTime ?? 0

    // 현재 자막 즉시 수집
    const currentText = getCurrentSubtitle()
    if (currentText && currentText !== lastCaptionText) {
      lastCaptionText = currentText
      subtitleHistory.push({ text: currentText, time: captureTime })
    }

    // 일시정지 상태면 잠깐 재생해 뒤 자막도 수집
    if (video?.paused) video.play()

    // 1.5초 더 재생한 뒤 정지
    setTimeout(() => {
      const v = getVideo()
      if (v && !v.paused) v.pause()

      // captureTime 기준 앞 3초 이내 항목
      const pool = subtitleHistory.filter((e) => e.time >= captureTime - 3)

      // pool 안에서 마지막 문장 끝 이후부터가 현재 문장
      let sentenceStartIdx = 0
      for (let i = pool.length - 2; i >= 0; i--) {
        if (/[.!?]\s*$/.test(pool[i].text)) {
          sentenceStartIdx = i + 1
          break
        }
      }

      const entries = pool.slice(sentenceStartIdx)
      const merged = mergeSubtitleChunks(entries.map((e) => e.text))
      // startTime = 현재 문장이 시작된 시점 (문장 경계 이후 첫 항목)
      const startTime = entries[0]?.time ?? captureTime

      // 이력 초기화
      subtitleHistory.length = 0
      lastCaptionText = ''

      sendResponse({ text: merged || currentText, startTime })
    }, 1500)

    return true // 비동기 응답
  }
})
