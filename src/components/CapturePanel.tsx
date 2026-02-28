import { useRef, useState } from 'react'
import { useDictionary } from '../hooks/useDictionary'
import { useTranslation } from '../hooks/useTranslation'

// ── 영어 기능어 목록 (약하게 발음되는 단어들) ───────────────────
// 이 목록에 없는 단어 = 내용어(content word) → 강세 표시
const FUNCTION_WORDS = new Set([
  // 관사
  'a', 'an', 'the',
  // 등위접속사
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  // 종속접속사
  'as', 'if', 'than', 'that', 'though', 'although', 'because',
  'since', 'unless', 'until', 'when', 'where', 'while', 'after',
  'before', 'whether', 'once', 'whereas',
  // 전치사
  'at', 'by', 'from', 'in', 'into', 'of', 'off', 'on', 'onto',
  'out', 'over', 'to', 'up', 'with', 'about', 'above', 'across',
  'against', 'along', 'among', 'around', 'behind', 'below',
  'beneath', 'beside', 'between', 'beyond', 'down', 'during',
  'except', 'inside', 'near', 'outside', 'per', 'through',
  'throughout', 'under', 'upon', 'via', 'within', 'without',
  // 조동사
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'can', 'could',
  // 인칭대명사
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  // 지시/관계사
  'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which',
  // 기타 허사
  'there', 'here', 'then', 'how',
])

function isContentWord(word: string): boolean {
  if (word.includes(' ')) return true  // 다단어 표현은 항상 강세
  return !FUNCTION_WORDS.has(word.toLowerCase())
}

// ── 파트 오브 스피치 색상 ─────────────────────────────────────
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

// ── 다단어 표현 목록 (긴 것부터 먼저 정의해야 greedy match 가능) ──────
const MULTI_WORD_EXPRESSIONS = [
  // 대조·열거
  'pros and cons', 'ups and downs', 'trial and error', 'back and forth',
  'sooner or later', 'more or less', 'more and more', 'once in a while',
  // 삼단어 구동사
  'get rid of', 'look forward to', 'come up with', 'take care of',
  'run out of', 'put up with', 'look up to', 'look down on',
  'catch up with', 'keep up with', 'look out for', 'make fun of',
  'go along with', 'deal with it', 'get away with',
  // 전치사구
  'in order to', 'so as to', 'as well as', 'rather than',
  'as long as', 'as soon as', 'even though', 'even if',
  'in spite of', 'due to', 'because of', 'instead of',
  'on behalf of', 'in terms of', 'in addition to', 'in addition',
  'in case of', 'in case', 'regardless of', 'prior to', 'as a result',
  'all of a sudden', 'in the end', 'at the same time', 'on the other hand',
  'in general', 'in particular', 'in fact', 'by the way',
  'at least', 'at most', 'at all', 'at first', 'at last', 'at once',
  'right away', 'so far', 'no matter', 'kind of', 'sort of',
  'a lot of', 'a lot', 'a bit', 'a little', 'each other', 'one another',
  // 이단어 구동사
  'break down', 'break out', 'break up', 'bring up', 'call off', 'call out',
  'calm down', 'carry on', 'carry out', 'catch up', 'check in', 'check out',
  'cheer up', 'clean up', 'come back', 'come on', 'come out', 'come up',
  'cut down', 'cut off', 'deal with', 'end up', 'fall apart', 'fall behind',
  'figure out', 'fill out', 'find out', 'get along', 'get away', 'get back',
  'get off', 'get on', 'get out', 'get over', 'get through', 'get up',
  'give away', 'give in', 'give up', 'go ahead', 'go back', 'go on',
  'go out', 'go over', 'go through', 'grow up', 'hang out', 'hang on',
  'hold on', 'hold back', 'keep on', 'keep up', 'let down', 'let go',
  'look after', 'look for', 'look into', 'look out', 'look up',
  'make out', 'make up', 'make sure', 'move on', 'pass out', 'pay off',
  'pick up', 'point out', 'put off', 'put on', 'put out', 'put up',
  'run away', 'run into', 'run out', 'set off', 'set up',
  'show off', 'show up', 'slow down', 'stand out', 'stand up',
  'start over', 'stay up', 'take off', 'take on', 'take out', 'take over',
  'take up', 'think about', 'think of', 'throw away', 'try out',
  'turn down', 'turn off', 'turn on', 'turn out', 'turn up',
  'use up', 'wake up', 'watch out', 'work on', 'work out',
]

// 긴 표현부터 매칭 (greedy) — 한 번만 컴파일
const _SORTED_EXPR = [...MULTI_WORD_EXPRESSIONS].sort((a, b) => b.length - a.length)
const _EXPR_RE = new RegExp(
  '(' +
    _SORTED_EXPR.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|') +
    '|[A-Za-z][A-Za-z\']*[A-Za-z]|[A-Za-z])',
  'gi',
)

function tokenize(text: string): Array<{ text: string; isWord: boolean }> {
  const result: Array<{ text: string; isWord: boolean }> = []
  let lastIndex = 0
  const re = new RegExp(_EXPR_RE.source, _EXPR_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) result.push({ text: text.slice(lastIndex, m.index), isWord: false })
    result.push({ text: m[0], isWord: true })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) result.push({ text: text.slice(lastIndex), isWord: false })
  return result
}

interface Props {
  canSave: boolean
  onSave?: (word: string, comment: string, context: string, startTime: number, wordTranslation?: string, endTime?: number) => Promise<void>
  onCapture?: () => Promise<{ text: string; startTime: number; endTime: number }>
  onResume?: () => void
}

export default function CapturePanel({ canSave, onSave, onCapture, onResume }: Props) {
  const [captured, setCaptured] = useState<{ text: string; startTime: number; endTime: number } | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedWord, setSavedWord] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { entry, loading: dictLoading, error: dictError, lookup, clear: clearDict } = useDictionary()
  const { translation: sentTrans, loading: sentTransLoading, translate: transSent, clear: clearSentTrans } = useTranslation()
  const { translation: wordTrans, translate: transWord, clear: clearWordTrans } = useTranslation()

  async function handleCapture() {
    if (!onCapture) return
    setCapturing(true)
    setCaptured(null)
    setSelectedWord(null)
    setSavedWord(null)
    clearDict()
    clearSentTrans()
    clearWordTrans()
    try {
      const result = await onCapture()
      if (result.text) {
        setCaptured(result)
        transSent(result.text)
      }
    } finally {
      setCapturing(false)
    }
  }

  function handleWordClick(word: string) {
    setSelectedWord(word)
    setSavedWord(null)
    lookup(word)
    transWord(word)
  }

  async function handleSave() {
    if (!onSave || !selectedWord || !captured) return
    setSaving(true)
    try {
      await onSave(selectedWord, comment, captured.text, captured.startTime, wordTrans ?? undefined, captured.endTime)
      setSavedWord(selectedWord)
      setComment('')
      setTimeout(() => setSavedWord(null), 2000)
    } finally {
      setSaving(false)
    }
  }

  function handleResume() {
    onResume?.()
    setCaptured(null)
    setSelectedWord(null)
    clearDict()
    clearSentTrans()
    clearWordTrans()
    setComment('')
    setSavedWord(null)
  }

  function playAudio() {
    if (!entry?.audio) return
    audioRef.current?.pause()
    audioRef.current = new Audio(entry.audio)
    audioRef.current.play()
  }

  const allExamples = entry
    ? entry.meanings.flatMap((m) => m.definitions.map((d) => d.example).filter(Boolean) as string[])
    : []

  return (
    <div className="flex flex-col gap-4">

      {/* ── 캡처 버튼 ── */}
      {!captured && (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-white py-8">
          {onCapture ? (
            <>
              <button
                onClick={handleCapture}
                disabled={capturing}
                className="flex items-center gap-2 rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {capturing ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    캡처 중…
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
                    </svg>
                    자막 캡처
                  </>
                )}
              </button>
              <p className="text-xs text-slate-400">영상 재생 중 클릭하면 현재 문장을 캡처해요</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">확장 프로그램에서만 자막 캡처가 가능해요.</p>
          )}
        </div>
      )}

      {/* ── 캡처된 문장 ── */}
      {captured && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">캡처된 문장</p>
              {/* 강세 범례 */}
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span className="font-semibold text-slate-700">강조</span>
                <span className="text-slate-300">/</span>
                <span>약음</span>
              </div>
            </div>
            <button
              onClick={handleResume}
              className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              계속 재생
            </button>
          </div>

          {/* 단어 칩 — 내용어(강세)와 기능어(약음) 구별 */}
          <p className="leading-9 text-sm">
            {tokenize(captured.text).map((token, i) => {
              if (!token.isWord) {
                return <span key={i} className="text-slate-400">{token.text}</span>
              }
              const isContent = isContentWord(token.text)
              const isSelected = selectedWord?.toLowerCase() === token.text.toLowerCase()
              return (
                <span
                  key={i}
                  onClick={() => handleWordClick(token.text)}
                  className={[
                    'relative inline-block cursor-pointer rounded px-0.5 transition-colors',
                    isSelected
                      ? 'bg-indigo-200 font-semibold text-indigo-800'
                      : isContent
                        ? 'font-semibold text-slate-800 hover:bg-indigo-100'
                        : 'font-normal text-slate-400 hover:bg-indigo-100 hover:text-slate-600',
                  ].join(' ')}
                >
                  {token.text}
                  {/* 내용어(강세) 표시 — 선택되지 않은 경우에만 점 표시 */}
                  {isContent && !isSelected && (
                    <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-400" />
                  )}
                </span>
              )
            })}
          </p>

          {/* 문장 번역 */}
          {sentTransLoading && <p className="mt-2 text-xs text-slate-400">번역 중…</p>}
          {sentTrans && !sentTransLoading && (
            <p className="mt-2 border-t border-indigo-200 pt-2 text-xs leading-relaxed text-indigo-700">
              {sentTrans}
            </p>
          )}

          {!selectedWord && (
            <p className="mt-2 text-[11px] text-indigo-400">
              ● 점이 있는 단어가 강조되는 부분 · 단어를 클릭해 사전을 확인하세요
            </p>
          )}
        </div>
      )}

      {/* ── 사전 카드 ── */}
      {selectedWord && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {dictLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              사전 검색 중…
            </div>
          )}

          {dictError && !dictLoading && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-700">"{selectedWord}"</span> — {dictError}
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

          {entry && !dictLoading && (
            <div className="flex flex-col gap-4">
              {/* 단어 헤더 */}
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold text-slate-800">{entry.word}</h3>
                {entry.phonetic && (
                  <span className="text-sm text-slate-400">{entry.phonetic}</span>
                )}
                {wordTrans && (
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-sm font-medium text-indigo-700">
                    {wordTrans}
                  </span>
                )}
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
              <div className="flex flex-col gap-3">
                {entry.meanings.map((m, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${PART_OF_SPEECH_COLOR[m.partOfSpeech] ?? 'text-indigo-500'}`}>
                      {m.partOfSpeech}
                    </span>
                    {m.definitions.map((d, j) => (
                      <div key={j} className="flex gap-1.5 pl-1 text-sm text-slate-700">
                        <span className="mt-1 shrink-0 text-[8px] text-slate-300">●</span>
                        <span>{d.definition}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* 예문 */}
              {allExamples.length > 0 && (
                <div className="rounded-lg bg-indigo-50 px-4 py-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-indigo-400">예문</p>
                  <div className="flex flex-col gap-2">
                    {allExamples.map((ex, i) => (
                      <p key={i} className="text-sm italic leading-relaxed text-indigo-700">"{ex}"</p>
                    ))}
                  </div>
                </div>
              )}

              {/* 코멘트 + 저장 */}
              {canSave && onSave && captured && (
                <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="코멘트 (선택)"
                    rows={2}
                    className="resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handleResume}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
                    >
                      ▶ 계속 재생
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${
                        savedWord
                          ? 'bg-green-50 text-green-600'
                          : 'bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50'
                      }`}
                    >
                      {saving ? (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          저장 중…
                        </span>
                      ) : savedWord ? '저장됨 ✓' : '저장'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
