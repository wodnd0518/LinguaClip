// Content script — YouTube 페이지에 주입됨
// 자막 이력 추적 + 플레이어 제어 브릿지

// ── 자막 이력 (문장 단위 캡처용) ─────────────────────────────
interface SubtitleEntry { text: string; time: number }
const subtitleHistory: SubtitleEntry[] = []
let lastCaptionText = ''

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
    const currentTime = video?.currentTime ?? 0

    // 현재 자막을 이력에 추가 (observer가 아직 못 잡았을 경우 대비)
    const currentText = getCurrentSubtitle()
    if (currentText && currentText !== lastCaptionText) {
      lastCaptionText = currentText
      subtitleHistory.push({ text: currentText, time: currentTime })
    }

    // 영상 일시정지
    if (video && !video.paused) video.pause()

    if (subtitleHistory.length === 0) {
      sendResponse({ text: '', startTime: currentTime })
      return true
    }

    // 마지막 문장 끝(. ! ?) 이후부터 현재까지를 하나의 문장으로 조합
    let sentenceStartIdx = 0
    for (let i = subtitleHistory.length - 2; i >= 0; i--) {
      if (/[.!?]\s*$/.test(subtitleHistory[i].text)) {
        sentenceStartIdx = i + 1
        break
      }
    }

    const entries = subtitleHistory.slice(sentenceStartIdx)
    const fullText = entries
      .map((e) => e.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const startTime = entries[0]?.time ?? currentTime

    // 다음 캡처를 위해 이력 초기화
    subtitleHistory.length = 0
    lastCaptionText = ''

    sendResponse({ text: fullText || currentText, startTime })
    return true
  }
})
