import { useState } from 'react'
import type { Clip } from '../hooks/useClips'

// 현재 시간 기준으로 어떤 단어가 발화 중인지 추정 (문자 수 비례 분배)
function getActiveWordIndex(words: string[], startTime: number, endTime: number, currentTime: number): number {
  if (endTime <= startTime || currentTime < startTime) return -1
  if (currentTime >= endTime) return words.length - 1
  const totalChars = words.reduce((sum, w) => sum + w.length, 0)
  if (totalChars === 0) return -1
  const progress = (currentTime - startTime) / (endTime - startTime)
  const targetChars = progress * totalChars
  let charCount = 0
  for (let i = 0; i < words.length; i++) {
    charCount += words[i].length
    if (charCount >= targetChars) return i
  }
  return words.length - 1
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedSentence({ sentence, word }: { sentence: string; word: string }) {
  const parts = sentence.split(new RegExp(`(${escapeRegex(word)})`, 'gi'))
  return (
    <p className="text-xs leading-relaxed text-slate-500">
      {parts.map((part, i) =>
        part.toLowerCase() === word.toLowerCase() ? (
          <mark key={i} className="rounded bg-indigo-100 px-0.5 font-semibold text-indigo-700 not-italic">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  clips: Clip[]
  loading: boolean
  currentVideoId: string | null
  onSeek: (clip: Clip) => void
  onDelete: (clipId: string) => Promise<void>
  onShadow?: (clip: Clip) => void       // 쉐도잉 시작/정지 토글
  shadowingClip?: Clip | null           // 현재 쉐도잉 중인 클립
  smoothCurrentTime?: number            // RAF로 보간된 현재 재생 시간
}

export default function SavedClips({ clips, loading, currentVideoId, onSeek, onDelete, onShadow, shadowingClip, smoothCurrentTime = 0 }: Props) {
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = searchQuery.trim()
    ? clips.filter((c) => c.sentence.toLowerCase().includes(searchQuery.toLowerCase()))
    : clips

  async function handleDelete(clipId: string) {
    setDeletingIds((prev) => new Set(prev).add(clipId))
    try {
      await onDelete(clipId)
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(clipId)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        <span>저장된 클립 불러오는 중…</span>
      </div>
    )
  }

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white py-10 text-slate-400">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <p className="text-sm">아직 저장된 클립이 없어요.</p>
        <p className="text-xs">자막 패널에서 문장 옆 저장 버튼을 눌러보세요.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 검색 입력 */}
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="클립 검색…"
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-4 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* 검색 결과 없음 */}
      {filtered.length === 0 && (
        <div className="py-8 text-center text-sm text-slate-400">
          "<span className="font-medium text-slate-600">{searchQuery}</span>"에 해당하는 클립이 없어요.
        </div>
      )}

      <div className="flex flex-col gap-2">
      {filtered.map((clip) => {
        const isSameVideo = clip.videoId === currentVideoId
        const isShadowing = shadowingClip?.id === clip.id
        // 카라오케: context(문장) 기준으로 단어 분리
        const karaokeWords = isShadowing && clip.context
          ? clip.context.split(/(\s+)/).filter(Boolean)
          : []
        const contentWords = karaokeWords.filter((w) => /\S/.test(w))
        const activeIdx = isShadowing && clip.endTime !== undefined
          ? getActiveWordIndex(contentWords, clip.timestamp, clip.endTime, smoothCurrentTime)
          : -1
        // 스페이스 포함 전체 토큰 중 몇 번째 content word인지 추적
        let contentWordCursor = -1
        return (
          <div
            key={clip.id}
            className={`group flex flex-col gap-2 rounded-xl border bg-white p-4 transition hover:shadow-sm ${
              isShadowing ? 'border-amber-300 shadow-sm' : 'border-slate-200 hover:border-indigo-200'
            }`}
          >
            {/* 상단 행: 타임스탬프 + 단어 + YouTube 링크 + 삭제 */}
            <div className="flex items-start gap-3">
              {/* 타임스탬프 이동 + 쉐도잉 재생 */}
              <div className="mt-0.5 flex shrink-0 flex-col gap-1">
                <button
                  onClick={() => onSeek(clip)}
                  title={isSameVideo ? '이 타임스탬프로 이동' : '이 영상 불러오기'}
                  className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 transition hover:bg-indigo-100 hover:text-indigo-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {formatTime(clip.timestamp)}
                </button>
                {onShadow && (
                  <button
                    onClick={() => onShadow(clip)}
                    title={isShadowing ? '쉐도잉 정지' : '이 구간 쉐도잉 재생'}
                    className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs transition ${
                      isShadowing
                        ? 'bg-amber-400 text-white hover:bg-amber-500'
                        : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                    }`}
                  >
                    {isShadowing ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                      </svg>
                    )}
                    {isShadowing ? '정지' : '쉐도잉'}
                  </button>
                )}
              </div>

              {/* 단어 + 한국어 뜻 + 문장 + 코멘트 */}
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-semibold text-slate-800">{clip.sentence}</p>
                  {clip.wordTranslation && (
                    <span className="text-xs text-slate-400">{clip.wordTranslation}</span>
                  )}
                </div>
                {clip.context && !isShadowing && (
                  <HighlightedSentence sentence={clip.context} word={clip.sentence} />
                )}
                {clip.comment && (
                  <p className="text-xs text-slate-400">{clip.comment}</p>
                )}
              </div>

              {/* YouTube에서 열기 */}
              <a
                href={`https://www.youtube.com/watch?v=${clip.videoId}&t=${Math.floor(clip.timestamp)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="YouTube에서 열기"
                className="mt-0.5 shrink-0 text-slate-300 transition hover:text-red-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>

              {/* 삭제 */}
              <button
                onClick={() => handleDelete(clip.id)}
                disabled={deletingIds.has(clip.id)}
                title="삭제"
                className="mt-0.5 shrink-0 text-slate-300 transition hover:text-red-400 disabled:opacity-50"
              >
                {deletingIds.has(clip.id) ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-300 border-t-transparent" />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                )}
              </button>
            </div>

            {/* 카라오케: 쉐도잉 중일 때 단어 하이라이트 */}
            {isShadowing && clip.context && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-loose">
                {karaokeWords.map((token, i) => {
                  if (/^\s+$/.test(token)) return <span key={i}>{token}</span>
                  contentWordCursor++
                  const isActive = contentWordCursor === activeIdx
                  return (
                    <span
                      key={i}
                      className={`transition-colors ${
                        isActive
                          ? 'rounded bg-amber-400 px-0.5 font-bold text-white'
                          : 'text-amber-800'
                      }`}
                    >
                      {token}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}
