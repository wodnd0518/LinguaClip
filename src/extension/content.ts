// Content script — YouTube 페이지에 주입됨
// 자막 이력 추적 + 플레이어 제어 브릿지

// ── 자막 이력 (문장 단위 캡처용) ─────────────────────────────
interface SubtitleEntry { text: string; time: number }
const subtitleHistory: SubtitleEntry[] = []
let lastCaptionText = ''

/**
 * YouTube 자동자막은 이전 청크를 포함해서 표시되는 경우가 많음.
 * 예) "I took the offer" → "I took the offer and funny"
 * → suffix-prefix 겹침을 제거해 하나의 문장으로 병합.
 */
function mergeSubtitleChunks(chunks: string[]): string {
  if (chunks.length === 0) return ''
  let result = chunks[0]
  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    if (!next) continue
    // result 끝 부분이 next 앞 부분과 겹치면 겹친 부분 제거
    const maxOverlap = Math.min(result.length, next.length, 100)
    let overlapLen = 0
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
  // #movie_player 가 SPA 렌더 후에도 항상 존재하는 YouTube 플레이어 루트
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

    // 1.5초 더 재생한 뒤 정지 → 앞 3초 + 뒤 1.5초 구간 병합
    setTimeout(() => {
      const v = getVideo()
      if (v && !v.paused) v.pause()

      // captureTime 기준 앞 3초 이내 항목만 사용
      const pool = subtitleHistory.filter((e) => e.time >= captureTime - 3)
      const merged = mergeSubtitleChunks(pool.map((e) => e.text))
      const startTime = pool[0]?.time ?? captureTime

      // 이력 초기화
      subtitleHistory.length = 0
      lastCaptionText = ''

      sendResponse({ text: merged || currentText, startTime })
    }, 1500)

    return true // 비동기 응답
  }
})
