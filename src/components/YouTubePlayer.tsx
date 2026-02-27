import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

// Module-level singleton — API 스크립트는 한 번만 로드
let ytApiPromise: Promise<void> | null = null

function ensureYouTubeAPI(): Promise<void> {
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise<void>((resolve) => {
    if (window.YT?.Player) {
      resolve()
      return
    }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
  return ytApiPromise
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export interface YouTubePlayerHandle {
  getCurrentTime: () => number
  seekTo: (seconds: number) => void
}

interface Props {
  videoId: string
}

const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { videoId },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YT.Player | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [embedBlocked, setEmbedBlocked] = useState(false)

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
    seekTo: (seconds: number) => playerRef.current?.seekTo(seconds, true),
  }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let active = true

    ensureYouTubeAPI().then(() => {
      if (!active || !containerRef.current) return

      playerRef.current?.destroy()
      setIsReady(false)
      setIsPlaying(false)
      setCurrentTime(0)
      setEmbedBlocked(false)

      // 매번 fresh div 생성 — YT API가 직접 교체함
      const div = document.createElement('div')
      container.innerHTML = ''
      container.appendChild(div)

      playerRef.current = new YT.Player(div, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: () => {
            if (active) setIsReady(true)
          },
          onStateChange: (e) => {
            if (!active) return
            setIsPlaying(e.data === 1) // PLAYING = 1
          },
          onError: (e) => {
            if (!active) return
            // 101, 150: 영상 소유자가 외부 임베드를 허용하지 않음
            if (e.data === 101 || e.data === 150) {
              setEmbedBlocked(true)
              setIsReady(false)
            }
          },
        },
      })
    })

    return () => {
      active = false
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [videoId])

  // 재생 중일 때 0.5초마다 현재 시간 업데이트
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      if (playerRef.current) setCurrentTime(playerRef.current.getCurrentTime())
    }, 500)
    return () => clearInterval(id)
  }, [isPlaying])

  return (
    <div className="flex flex-col gap-3">
      {/* 플레이어 컨테이너 — embedBlocked일 때는 숨기고 에러 UI 표시 */}
      <div
        ref={containerRef}
        className={`aspect-video w-full overflow-hidden rounded-xl bg-black shadow-lg ${embedBlocked ? 'hidden' : ''}`}
      />

      {embedBlocked && (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-200 bg-white text-center">
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-slate-400"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <p className="font-medium text-slate-700">이 영상은 외부 사이트 재생이 제한돼 있어요.</p>
            <p className="text-sm text-slate-400">영상 소유자가 임베드를 허용하지 않았습니다.</p>
          </div>
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-red-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
            YouTube에서 보기
          </a>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        {embedBlocked ? null : isReady ? (
          <>
            <span className="font-mono text-base font-medium text-slate-800">
              {formatTime(currentTime)}
            </span>
            <div
              className={`h-2 w-2 rounded-full transition-colors ${isPlaying ? 'bg-green-400' : 'bg-slate-300'}`}
            />
            <span className="text-slate-500">{isPlaying ? '재생 중' : '일시정지'}</span>
          </>
        ) : (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
            <span className="text-slate-400">플레이어 로딩 중…</span>
          </>
        )}
      </div>
    </div>
  )
})

export default YouTubePlayer
