import type { VideoInfo } from '../hooks/useYouTubeTab'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  videoInfo: VideoInfo | null
  isOnYouTube: boolean
}

export default function YouTubeStatus({ videoInfo, isOnYouTube }: Props) {
  if (!isOnYouTube) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="44"
            height="44"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 8a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z" />
            <path d="m10 9 5 3-5 3V9Z" />
          </svg>
          <p className="text-sm">YouTube에서 영상을 재생한 뒤<br />이 패널을 열어주세요.</p>
          <a
            href="https://www.youtube.com"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
          >
            YouTube 열기
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {/* 영상 제목 */}
        <div className="mb-3 flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </div>
          <p className="flex-1 text-sm font-medium leading-snug text-slate-800 line-clamp-2">
            {videoInfo?.title ?? '영상 로딩 중…'}
          </p>
        </div>

        {/* 타임스탬프 + 재생 상태 */}
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-base font-semibold text-slate-800">
            {formatTime(videoInfo?.currentTime ?? 0)}
          </span>
          {videoInfo?.duration ? (
            <span className="text-slate-400">/ {formatTime(videoInfo.duration)}</span>
          ) : null}
          <div
            className={`ml-1 h-2 w-2 rounded-full transition-colors ${
              videoInfo && !videoInfo.paused ? 'bg-green-400' : 'bg-slate-300'
            }`}
          />
          <span className="text-slate-500">
            {videoInfo ? (videoInfo.paused ? '일시정지' : '재생 중') : '연결 중…'}
          </span>
        </div>

        {/* 진행 바 */}
        {videoInfo?.duration ? (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-400 transition-all duration-500"
              style={{ width: `${(videoInfo.currentTime / videoInfo.duration) * 100}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
