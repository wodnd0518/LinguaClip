import { useRef, useState } from 'react'
import { useDictionary } from '../hooks/useDictionary'

const PART_OF_SPEECH_COLOR: Record<string, string> = {
  noun: 'text-blue-500',
  verb: 'text-green-500',
  adjective: 'text-orange-500',
  adverb: 'text-purple-500',
  pronoun: 'text-pink-500',
  preposition: 'text-teal-500',
  conjunction: 'text-red-500',
  interjection: 'text-yellow-500',
}

interface Props {
  canSave: boolean
  onSave?: (word: string, comment: string) => Promise<void>
}

export default function WordSearchPanel({ canSave, onSave }: Props) {
  const [query, setQuery] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedWord, setSavedWord] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { entry, loading, error, lookup, clear } = useDictionary()

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const word = query.trim()
    if (!word) return
    setSavedWord(null)
    lookup(word)
  }

  function handleQueryChange(value: string) {
    setQuery(value)
    if (!value.trim()) clear()
  }

  function playAudio() {
    if (!entry?.audio) return
    audioRef.current?.pause()
    audioRef.current = new Audio(entry.audio)
    audioRef.current.play()
  }

  async function handleSave() {
    if (!onSave || !entry) return
    setSaving(true)
    try {
      await onSave(entry.word, comment)
      setSavedWord(entry.word)
      setComment('')
      setTimeout(() => setSavedWord(null), 2000)
    } finally {
      setSaving(false)
    }
  }

  const posColor = entry ? (PART_OF_SPEECH_COLOR[entry.meanings[0]?.partOfSpeech] ?? 'text-indigo-500') : ''

  return (
    <div className="flex flex-col gap-4">
      {/* 단어 검색 */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="단어를 입력하세요 (예: serendipity)"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="submit"
          disabled={!query.trim()}
          className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          검색
        </button>
      </form>

      {/* 로딩 */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <span>사전 검색 중…</span>
        </div>
      )}

      {/* 에러 */}
      {error && !loading && (
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">"{query}"</span> — {error}
          </p>
          <a
            href={`https://www.google.com/search?q=define+${encodeURIComponent(query)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-3 shrink-0 text-xs text-indigo-500 underline-offset-2 hover:underline"
          >
            Google에서 찾기 →
          </a>
        </div>
      )}

      {/* 사전 카드 */}
      {entry && !loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* 단어 헤더 */}
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-slate-800">{entry.word}</h3>
            {entry.phonetic && <span className="text-sm text-slate-400">{entry.phonetic}</span>}
            {entry.audio && (
              <button
                onClick={playAudio}
                title="발음 듣기"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-indigo-300 hover:text-indigo-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
            <a
              href={`https://www.google.com/search?q=define+${encodeURIComponent(entry.word)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-slate-400 underline-offset-2 hover:text-indigo-500 hover:underline"
            >
              더 보기 →
            </a>
          </div>

          {/* 뜻 */}
          <div className="mt-4 flex flex-col gap-3">
            {entry.meanings.map((m, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <span className={`text-xs font-semibold uppercase tracking-wider ${PART_OF_SPEECH_COLOR[m.partOfSpeech] ?? posColor}`}>
                  {m.partOfSpeech}
                </span>
                {m.definitions.map((d, j) => (
                  <div key={j} className="flex flex-col gap-0.5 border-l-2 border-slate-100 pl-3">
                    <p className="text-sm text-slate-700">{d.definition}</p>
                    {d.example && <p className="text-xs italic text-slate-400">"{d.example}"</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* 코멘트 + 저장 */}
          {canSave && onSave && (
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="코멘트 (선택) — 예: IKEA 영상에서 나온 표현"
                rows={2}
                className="resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className={`self-end rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed
                  ${savedWord
                    ? 'bg-green-50 text-green-600'
                    : 'bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50'
                  }`}
              >
                {saving ? (
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    저장 중…
                  </div>
                ) : savedWord ? (
                  '저장됨 ✓'
                ) : (
                  '현재 타임스탬프로 저장'
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 영상 미재생 안내 */}
      {!canSave && entry && !loading && (
        <p className="text-xs text-slate-400">
          저장하려면 YouTube 영상을 먼저 재생하세요.
        </p>
      )}
    </div>
  )
}
