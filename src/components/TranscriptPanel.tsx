import { useEffect, useRef, useState } from 'react'
import { useTranscript, type TranscriptLine, type TranscriptLanguage } from '../hooks/useTranscript'
import { useDictionary } from '../hooks/useDictionary'
import { useTranslation } from '../hooks/useTranslation'

// ── 영어 기능어 목록 ───────────────────────────────────────────
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'as', 'if', 'than', 'that', 'though', 'although', 'because',
  'since', 'unless', 'until', 'when', 'where', 'while', 'after',
  'before', 'whether', 'once', 'whereas',
  'at', 'by', 'from', 'in', 'into', 'of', 'off', 'on', 'onto',
  'out', 'over', 'to', 'up', 'with', 'about', 'above', 'across',
  'against', 'along', 'among', 'around', 'behind', 'below',
  'beneath', 'beside', 'between', 'beyond', 'down', 'during',
  'except', 'inside', 'near', 'outside', 'per', 'through',
  'throughout', 'under', 'upon', 'via', 'within', 'without',
  'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'can', 'could',
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which',
  'there', 'here', 'then', 'how',
])

function isContentWord(word: string): boolean {
  if (word.includes(' ')) return true
  return !FUNCTION_WORDS.has(word.toLowerCase())
}

// ── 다단어 표현 목록 ──────────────────────────────────────────
const MULTI_WORD_EXPRESSIONS = [
  'pros and cons', 'ups and downs', 'trial and error', 'back and forth',
  'sooner or later', 'more or less', 'more and more', 'once in a while',
  'get rid of', 'look forward to', 'come up with', 'take care of',
  'run out of', 'put up with', 'look up to', 'look down on',
  'catch up with', 'keep up with', 'look out for', 'make fun of',
  'go along with', 'deal with it', 'get away with',
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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

interface Props {
  videoId: string | null
  currentTime: number
  onSeek: (time: number) => void
  onSave?: (word: string, comment: string, context: string, startTime: number, wordTranslation?: string, endTime?: number, videoId?: string) => Promise<void>
}

export default function TranscriptPanel({ videoId, currentTime, onSeek, onSave }: Props) {
  const { loading: transcriptLoading, error: transcriptError, load } = useTranscript()

  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [languages, setLanguages] = useState<TranscriptLanguage[]>([])
  const [selectedLang, setSelectedLang] = useState('en')
  const [loaded, setLoaded] = useState(false)
  const [capturedLine, setCapturedLine] = useState<TranscriptLine | null>(null)
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedWord, setSavedWord] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { entry, loading: dictLoading, error: dictError, lookup, clear: clearDict } = useDictionary()
  const { translation: wordTrans, translate: transWord, clear: clearWordTrans } = useTranslation()
  const { translation: sentTrans, loading: sentTransLoading, translate: transSent, clear: clearSentTrans } = useTranslation()

  // scroll refs
  const listRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const userScrollingRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // reset when videoId changes
  useEffect(() => {
    setLines([])
    setLanguages([])
    setLoaded(false)
    setCapturedLine(null)
    setSelectedWord(null)
    setComment('')
    setSavedWord(null)
    clearDict()
    clearSentTrans()
    clearWordTrans()
  }, [videoId])

  // detect user scroll → pause auto-scroll for 3s
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    function onScroll() {
      userScrollingRef.current = true
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = setTimeout(() => {
        userScrollingRef.current = false
      }, 3000)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // compute active line index
  const activeIndex = lines.length > 0
    ? lines.reduce((best, line, i) => (line.start <= currentTime ? i : best), -1)
    : -1

  // auto-scroll active line into view
  useEffect(() => {
    if (userScrollingRef.current) return
    activeLineRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  async function handleLoad() {
    if (!videoId) return
    const result = await load(videoId, selectedLang)
    if (result) {
      setLines(result.lines)
      setLanguages(result.languages)
      setSelectedLang(result.selectedLang)
      setLoaded(true)
    }
  }

  async function handleLangChange(lang: string) {
    setSelectedLang(lang)
    if (!videoId) return
    const result = await load(videoId, lang)
    if (result) {
      setLines(result.lines)
      setSelectedLang(result.selectedLang)
    }
  }

  function handleCapture() {
    if (activeIndex < 0 || !lines[activeIndex]) return
    const line = lines[activeIndex]
    setCapturedLine(line)
    setSelectedWord(null)
    setComment('')
    setSavedWord(null)
    clearDict()
    clearWordTrans()
    clearSentTrans()
    transSent(line.text)
  }

  function handleWordClick(word: string) {
    setSelectedWord(word)
    setSavedWord(null)
    clearDict()
    clearSentTrans()
    clearWordTrans()
    lookup(word)
    transWord(word)
  }

  async function handleSave() {
    if (!onSave || !selectedWord || !capturedLine) return
    setSaving(true)
    try {
      const endTime = capturedLine.start + capturedLine.dur
      await onSave(selectedWord, comment, capturedLine.text, capturedLine.start, wordTrans ?? undefined, endTime, videoId ?? undefined)
      setSavedWord(selectedWord)
      setComment('')
      setTimeout(() => setSavedWord(null), 2000)
    } finally {
      setSaving(false)
    }
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
    <div className="flex h-full flex-col gap-3">

      {/* ── 헤더 ── */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">스크립트</span>
        {loaded && languages.length > 1 && (
          <select
            value={selectedLang}
            onChange={(e) => handleLangChange(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 outline-none transition focus:border-indigo-300"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}{l.isAuto ? ' (자동)' : ''}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={handleLoad}
          disabled={!videoId || transcriptLoading}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {transcriptLoading ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              불러오는 중…
            </>
          ) : (
            '자막 불러오기'
          )}
        </button>
      </div>

      {/* ── 에러 ── */}
      {transcriptError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
          {transcriptError}
        </div>
      )}

      {/* ── 빈 상태 ── */}
      {!loaded && !transcriptLoading && !transcriptError && (
        <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white py-12 text-sm text-slate-400">
          {videoId ? '"자막 불러오기"를 눌러 스크립트를 가져오세요' : '영상을 선택하면 자막을 불러올 수 있어요'}
        </div>
      )}

      {/* ── 캡처 버튼 ── */}
      {loaded && lines.length > 0 && (
        <button
          onClick={handleCapture}
          disabled={activeIndex < 0}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="text-[10px] text-red-500">●</span>
          현재 문장 캡처
        </button>
      )}

      {/* ── 자막 목록 ── */}
      {loaded && lines.length > 0 && (
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white"
          style={{ maxHeight: '320px' }}
        >
          {lines.map((line, i) => {
            const isActive = i === activeIndex
            return (
              <div
                key={i}
                ref={isActive ? activeLineRef : undefined}
                className={[
                  'flex gap-2 px-3 py-2 transition-colors',
                  isActive ? 'bg-indigo-50' : 'hover:bg-slate-50',
                ].join(' ')}
              >
                {/* 타임스탬프 */}
                <button
                  onClick={() => onSeek(line.start)}
                  className="mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[11px] text-indigo-400 transition hover:bg-indigo-100 hover:text-indigo-600"
                >
                  {formatTime(line.start)}
                </button>

                {/* 일반 텍스트 (단어 클릭 없음) */}
                <p className={['flex-1 text-sm leading-7', isActive ? 'font-medium text-slate-800' : 'text-slate-600'].join(' ')}>
                  {line.text}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 캡처된 문장 패널 ── */}
      {capturedLine && (
        <div className="flex flex-col gap-3">

          {/* 문장 + 번역 + 저장 */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">캡처된 문장</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onSeek(capturedLine.start)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-600"
                >
                  {formatTime(capturedLine.start)} ↗
                </button>
                <button
                  onClick={() => {
                    setCapturedLine(null)
                    setSelectedWord(null)
                    clearDict()
                    clearWordTrans()
                    clearSentTrans()
                  }}
                  className="text-slate-400 hover:text-slate-600"
                  title="닫기"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 토큰화된 단어 클릭 영역 */}
            <p className="text-sm leading-7 text-slate-700">
              {tokenize(capturedLine.text).map((token, ti) => {
                if (!token.isWord) {
                  return <span key={ti} className="text-slate-400">{token.text}</span>
                }
                const isContent = isContentWord(token.text)
                const isSelected = selectedWord?.toLowerCase() === token.text.toLowerCase()
                return (
                  <span
                    key={ti}
                    onClick={() => handleWordClick(token.text)}
                    className={[
                      'relative inline-block cursor-pointer rounded px-0.5 transition-colors',
                      isSelected
                        ? 'bg-indigo-200 font-semibold text-indigo-800'
                        : isContent
                          ? 'font-semibold hover:bg-indigo-100'
                          : 'hover:bg-indigo-100',
                    ].join(' ')}
                  >
                    {token.text}
                    {isContent && !isSelected && (
                      <span className="absolute -top-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-400" />
                    )}
                  </span>
                )
              })}
            </p>

            {sentTransLoading && <p className="mt-1.5 text-xs text-slate-400">번역 중…</p>}
            {sentTrans && !sentTransLoading && (
              <p className="mt-1.5 border-t border-indigo-200 pt-1.5 text-xs leading-relaxed text-indigo-700">
                {sentTrans}
              </p>
            )}

            {/* 코멘트 + 저장 */}
            <div className="mt-3 flex flex-col gap-2 border-t border-indigo-200 pt-3">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="코멘트 (선택)"
                rows={2}
                className="resize-none rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <div className="flex justify-end">
                <button
                  onClick={onSave ? handleSave : undefined}
                  disabled={saving || !onSave || !selectedWord}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${
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
          </div>

          {/* 사전 카드 */}
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
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  )
}
