import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { IS_EXT } from '../lib/env'
import { useYouTubeTab } from '../hooks/useYouTubeTab'
import YouTubePlayer, { type YouTubePlayerHandle } from './YouTubePlayer'
import YouTubeStatus from './YouTubeStatus'
import TranscriptPanel from './TranscriptPanel'
import SavedClips from './SavedClips'
import { useClips, type Clip } from '../hooks/useClips'

function extractVideoId(input: string): string | null {
  const t = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(t)) return t
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = t.match(p)
    if (m) return m[1]
  }
  return null
}

export default function Dashboard() {
  const { user, signOutUser } = useAuth()

  // 확장 프로그램: YouTube 탭 연동
  const { videoInfo, isOnYouTube, seekTo: ytSeekTo, navigateTab, startShadow, stopShadow } = useYouTubeTab()

  // 웹 전용: URL 입력 + IFrame 플레이어
  const [urlInput, setUrlInput] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [urlError, setUrlError] = useState('')
  const playerRef = useRef<YouTubePlayerHandle>(null)

  const { clips, loading: clipsLoading, saveClip, deleteClip } = useClips(user!.uid)

  // 웹 모드 currentTime 폴링 (0.5초 간격)
  const [webCurrentTime, setWebCurrentTime] = useState(0)
  useEffect(() => {
    if (IS_EXT || !videoId) return
    const id = setInterval(() => {
      const t = playerRef.current?.getCurrentTime() ?? 0
      setWebCurrentTime(t)
    }, 500)
    return () => clearInterval(id)
  }, [videoId])

  // 쉐도잉 상태
  const [shadowingClip, setShadowingClip] = useState<Clip | null>(null)
  const [smoothCurrentTime, setSmoothCurrentTime] = useState(0)
  const rafRef = useRef<number | null>(null)
  // RAF 기준점: [videoTime, wallTime]
  const timeAnchorRef = useRef<[number, number]>([0, 0])
  // stale closure 방지용 ref (RAF tick 내에서 최신 shadowingClip 참조)
  const shadowingClipRef = useRef<Clip | null>(null)
  useEffect(() => { shadowingClipRef.current = shadowingClip }, [shadowingClip])

  // videoInfo.currentTime 업데이트 시 앵커 갱신
  useEffect(() => {
    if (videoInfo && !videoInfo.paused) {
      timeAnchorRef.current = [videoInfo.currentTime, performance.now()]
    }
  }, [videoInfo])

  // RAF 루프: 쉐도잉 중일 때만 smoothCurrentTime 업데이트
  useEffect(() => {
    if (!shadowingClip) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      return
    }
    function tick() {
      const [anchorVt, anchorWt] = timeAnchorRef.current
      const elapsed = (performance.now() - anchorWt) / 1000
      let t = anchorVt + elapsed
      // 구간을 넘어서 over-extrapolate 하지 않도록 to에서 클램프
      // → 루프백이 일어나기 전까지 마지막 단어에서 멈춤
      const sc = shadowingClipRef.current
      if (sc) {
        const to = sc.endTime ?? sc.timestamp + 7
        if (t > to) t = to
      }
      setSmoothCurrentTime(t)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [shadowingClip])

  // 현재 재생 위치 반환 — 모드에 따라 소스가 다름
  function getCurrentTime(): number {
    if (IS_EXT) return videoInfo?.currentTime ?? 0
    return playerRef.current?.getCurrentTime() ?? 0
  }

  // 현재 영상 ID 반환
  function getCurrentVideoId(): string {
    if (IS_EXT) return videoInfo?.videoId ?? ''
    return videoId ?? ''
  }

  function handleLoad(e: React.FormEvent) {
    e.preventDefault()
    const id = extractVideoId(urlInput)
    if (!id) {
      setUrlError('유효한 YouTube URL 또는 영상 ID를 입력해 주세요.')
      return
    }
    setUrlError('')
    setVideoId(id)
  }

  async function handleSave(word: string, comment: string, context: string, startTime?: number, wordTranslation?: string, endTime?: number, videoId?: string): Promise<void> {
    const time = startTime !== undefined ? startTime : getCurrentTime()
    await saveClip(word, videoId || getCurrentVideoId(), time, comment, context, wordTranslation, endTime)
  }

  function handleSeek(clip: Clip) {
    if (IS_EXT) {
      if (clip.videoId === videoInfo?.videoId) {
        ytSeekTo(clip.timestamp) // 같은 영상 → 바로 이동
      } else {
        navigateTab(clip.videoId, clip.timestamp) // 다른 영상 → YouTube 탭 이동
      }
      return
    }
    // 웹 모드
    if (clip.videoId === videoId) {
      playerRef.current?.seekTo(clip.timestamp)
    } else {
      setVideoId(clip.videoId)
      setUrlInput(`https://www.youtube.com/watch?v=${clip.videoId}`)
    }
  }

  // 쉐도잉: 해당 구간 무한 반복
  function handleShadow(clip: Clip) {
    // 이미 같은 클립 쉐도잉 중이면 정지
    if (shadowingClip?.id === clip.id) {
      setShadowingClip(null)
      if (IS_EXT) stopShadow()
      return
    }
    if (IS_EXT) {
      if (clip.videoId === videoInfo?.videoId) {
        const from = clip.timestamp
        const to = clip.endTime ?? clip.timestamp + 7
        startShadow(from, to)
        setShadowingClip(clip)
        timeAnchorRef.current = [from, performance.now()]
      } else {
        navigateTab(clip.videoId, clip.timestamp)
      }
      return
    }
    if (clip.videoId === videoId) {
      playerRef.current?.seekTo(clip.timestamp)
    } else {
      setVideoId(clip.videoId)
      setUrlInput(`https://www.youtube.com/watch?v=${clip.videoId}`)
    }
  }

  const canSave = IS_EXT ? true : !!videoId

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-slate-800">
            Lingua<span className="text-indigo-500">Clip</span>
          </h1>
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <img
                src={user.photoURL}
                alt={user.displayName ?? ''}
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-full"
              />
            )}
            <span className="hidden text-sm text-slate-600 sm:block">{user?.displayName}</span>
            <button
              onClick={signOutUser}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">

          {/* 왼쪽: 플레이어 영역 */}
          <div className="flex flex-col gap-4 lg:w-[55%]">
            {IS_EXT ? (
              // 확장 프로그램 모드: YouTube 탭 상태 표시
              <YouTubeStatus videoInfo={videoInfo} isOnYouTube={isOnYouTube} />
            ) : (
              // 웹 모드: URL 입력 + IFrame 플레이어
              <>
                <form onSubmit={handleLoad} className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-slate-700">YouTube URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => { setUrlInput(e.target.value); setUrlError('') }}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-600 active:bg-indigo-700"
                    >
                      불러오기
                    </button>
                  </div>
                  {urlError && <p className="text-sm text-red-500">{urlError}</p>}
                </form>

                {videoId ? (
                  <YouTubePlayer ref={playerRef} videoId={videoId} />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
                    <div className="flex flex-col items-center gap-3">
                      <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 8a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z" />
                        <path d="m10 9 5 3-5 3V9Z" />
                      </svg>
                      <span className="text-sm">YouTube URL을 입력해 영상을 불러오세요</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 오른쪽: 전체 스크립트 뷰어 */}
          <div className="lg:flex-1">
            <TranscriptPanel
              videoId={IS_EXT ? (videoInfo?.videoId ?? null) : videoId}
              currentTime={IS_EXT ? (videoInfo?.currentTime ?? 0) : webCurrentTime}
              onSeek={IS_EXT ? ytSeekTo : (t) => playerRef.current?.seekTo(t)}
              onSave={canSave ? handleSave : undefined}
            />
          </div>

        </div>

        {/* 하단: 저장된 클립 */}
        <div className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-700">
              저장된 클립
              {clips.length > 0 && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-600">
                  {clips.length}
                </span>
              )}
            </h2>
          </div>
          <SavedClips
            clips={clips}
            loading={clipsLoading}
            currentVideoId={getCurrentVideoId()}
            onSeek={handleSeek}
            onDelete={deleteClip}
            onShadow={IS_EXT ? handleShadow : undefined}
            shadowingClip={shadowingClip}
            smoothCurrentTime={smoothCurrentTime}
          />
        </div>
      </main>
    </div>
  )
}
