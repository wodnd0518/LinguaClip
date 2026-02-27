declare namespace YT {
  class Player {
    constructor(el: HTMLElement | string, opts: PlayerOptions)
    playVideo(): void
    pauseVideo(): void
    seekTo(seconds: number, allowSeekAhead?: boolean): void
    getCurrentTime(): number
    getPlayerState(): number
    destroy(): void
  }

  interface PlayerOptions {
    videoId?: string
    width?: number | string
    height?: number | string
    playerVars?: {
      autoplay?: 0 | 1
      controls?: 0 | 1 | 2
      modestbranding?: 0 | 1
      rel?: 0 | 1
      playsinline?: 0 | 1
      iv_load_policy?: 1 | 3
      cc_load_policy?: 0 | 1
    }
    events?: {
      onReady?: (e: { target: Player }) => void
      onStateChange?: (e: { target: Player; data: number }) => void
      onError?: (e: { target: Player; data: number }) => void
    }
  }

  const PlayerState: {
    UNSTARTED: -1
    ENDED: 0
    PLAYING: 1
    PAUSED: 2
    BUFFERING: 3
    CUED: 5
  }
}

interface Window {
  YT: typeof YT
  onYouTubeIframeAPIReady: () => void
}
