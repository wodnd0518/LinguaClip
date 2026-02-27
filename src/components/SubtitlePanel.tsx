import { useRef, useState } from 'react'
import { useDictionary } from '../hooks/useDictionary'

interface Token {
  text: string
  isWord: boolean
}

// 영문 단어(apostrophe 포함)와 나머지로 분리
function tokenize(line: string): Token[] {
  return line
    .split(/([A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z])/)
    .filter(Boolean)
    .map((text) => ({ text, isWord: /[A-Za-z]/.test(text) }))
}

interface WordChipProps {
  text: string
  isSelected: boolean
  onClick: () => void
}

function WordChip({ text, isSelected, onClick }: WordChipProps) {
  return (
    <span
      onClick={onClick}
      className={`cursor-pointer rounded px-0.5 transition-colors hover:bg-indigo-100 hover:text-indigo-700 ${
        isSelected ? 'bg-indigo-100 font-medium text-indigo-700' : ''
      }`}
    >
      {text}
    </span>
  )
}

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
  onSave?: (sentence: string) => Promise<void>
}

export default function SubtitlePanel({ onSave }: Props) {
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  const [savedIdxs, setSavedIdxs] = useState<Set<number>>(new Set())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { entry, loading, error, lookup, clear } = useDictionary()

  function handleAnalyze() {
    const parsed = input
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    setLines(parsed)
    setSelectedWord(null)
    clear()
  }

  async function handleSave(line: string, idx: number) {
    if (!onSave || savingIdx === idx) return
    setSavingIdx(idx)
    try {
      await onSave(line)
      setSavedIdxs((prev) => new Set(prev).add(idx))
      setTimeout(() => {
        setSavedIdxs((prev) => {
          const next = new Set(prev)
          next.delete(idx)
          return next
        })
      }, 2000)
    } finally {
      setSavingIdx(null)
    }
  }

  function handleWordClick(word: string) {
    setSelectedWord(word)
    lookup(word)
  }

  function playAudio() {
    if (!entry?.audio) return
    audioRef.current?.pause()
    audioRef.current = new Audio(entry.audio)
    audioRef.current.play()
  }

  const posColor = entry ? (PART_OF_SPEECH_COLOR[entry.meanings[0]?.partOfSpeech] ?? 'text-indigo-500') : ''

  return (
    <div className="flex flex-col gap-4">
      {/* 입력 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-slate-700">자막 / 스크립트</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            'YouTube 자막이나 스크립트를 여기에 붙여넣으세요.\n\nThe quick brown fox jumps over the lazy dog.'
          }
          rows={5}
          className="resize-none rounded-lg border border-slate-300 px-4 py-3 font-mono text-sm leading-relaxed outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <button
          onClick={handleAnalyze}
          disabled={!input.trim()}
          className="self-end rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          단어 분석
        </button>
      </div>

      {/* 파싱된 텍스트 */}
      {lines.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-medium text-slate-400">단어를 클릭하면 사전이 열립니다</p>
          <div className="flex flex-col gap-1">
            {lines.map((line, i) => (
              <div key={i} className="group flex items-start gap-2">
                <p className="flex-1 text-sm leading-8 text-slate-800">
                  {tokenize(line).map((token, j) =>
                    token.isWord ? (
                      <WordChip
                        key={j}
                        text={token.text}
                        isSelected={selectedWord?.toLowerCase() === token.text.toLowerCase()}
                        onClick={() => handleWordClick(token.text)}
                      />
                    ) : (
                      <span key={j} className="text-slate-500">
                        {token.text}
                      </span>
                    ),
                  )}
                </p>
                {onSave && (
                  <button
                    onClick={() => handleSave(line, i)}
                    disabled={savingIdx === i}
                    title="현재 타임스탬프로 저장"
                    className={`mt-1.5 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition
                      opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                      ${savedIdxs.has(i)
                        ? 'bg-green-50 text-green-600'
                        : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                      } disabled:cursor-not-allowed`}
                  >
                    {savingIdx === i ? (
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                    ) : savedIdxs.has(i) ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        저장됨
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                        저장
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 사전 카드 */}
      {selectedWord && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              <span>사전 검색 중…</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-700">"{selectedWord}"</span> — {error}
              </p>
              <a
                href={`https://www.google.com/search?q=define+${encodeURIComponent(selectedWord)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 shrink-0 text-xs text-indigo-500 underline-offset-2 hover:underline"
              >
                Google에서 찾기 →
              </a>
            </div>
          )}

          {entry && !loading && (
            <div className="flex flex-col gap-4">
              {/* 단어 + 발음 + 오디오 */}
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-800">{entry.word}</h3>
                {entry.phonetic && (
                  <span className="text-sm text-slate-400">{entry.phonetic}</span>
                )}
                {entry.audio && (
                  <button
                    onClick={playAudio}
                    title="발음 듣기"
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-indigo-300 hover:text-indigo-500"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
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

              {/* 의미 */}
              <div className="flex flex-col gap-3">
                {entry.meanings.map((m, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <span
                      className={`text-xs font-semibold uppercase tracking-wider ${PART_OF_SPEECH_COLOR[m.partOfSpeech] ?? posColor}`}
                    >
                      {m.partOfSpeech}
                    </span>
                    {m.definitions.map((d, j) => (
                      <div key={j} className="flex flex-col gap-0.5 pl-3 border-l-2 border-slate-100">
                        <p className="text-sm text-slate-700">{d.definition}</p>
                        {d.example && (
                          <p className="text-xs italic text-slate-400">"{d.example}"</p>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
