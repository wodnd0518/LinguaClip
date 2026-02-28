import { useState } from 'react'
import type { Clip } from '../hooks/useClips'

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
}

export default function SavedClips({ clips, loading, currentVideoId, onSeek, onDelete }: Props) {
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
        return (
          <div
            key={clip.id}
            className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:shadow-sm"
          >
            {/* 타임스탬프 — 클릭 시 이동 */}
            <button
              onClick={() => onSeek(clip)}
              title={isSameVideo ? '이 타임스탬프로 이동' : '이 영상 불러오기'}
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 transition hover:bg-indigo-100 hover:text-indigo-700"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              {formatTime(clip.timestamp)}
            </button>

            {/* 단어 + 문장 + 코멘트 */}
            <div className="flex flex-1 flex-col gap-1">
              <p className="text-sm font-semibold text-slate-800">{clip.sentence}</p>
              {clip.context && (
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
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
        )
      })}
      </div>
    </div>
  )
}
