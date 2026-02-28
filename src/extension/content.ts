// Content script — YouTube 페이지에 주입됨
// YouTube 네이티브 플레이어 + 사이드 패널 간 브릿지 역할

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

  if (message.type === 'YT_GET_SUBTITLE') {
    // 현재 화면에 표시 중인 자막 텍스트를 DOM에서 읽기
    const segments = document.querySelectorAll('.ytp-caption-segment')
    const text = Array.from(segments)
      .map((el) => el.textContent ?? '')
      .join(' ')
      .trim()
    sendResponse({ text })
    return true
  }
})
