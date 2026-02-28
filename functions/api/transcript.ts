// Cloudflare Pages Function — YouTube 자막 프록시
// 브라우저에서 직접 호출하면 CORS 오류가 나는 YouTube API를 서버에서 대신 호출

interface CaptionSegment {
  tStartMs: number
  dDurationMs?: number
  segs?: { utf8: string }[]
}

function parseJson3(events: CaptionSegment[]) {
  return (events ?? [])
    .filter((e) => (e.segs?.length ?? 0) > 0)
    .map((e) => ({
      start: e.tStartMs / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text: (e.segs ?? [])
        .map((s) => s.utf8)
        .join('')
        .replace(/\n/g, ' ')
        .trim(),
    }))
    .filter((l) => l.text)
}

function cleanXmlText(s: string) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ')
    .trim()
}

// srv1 포맷: <text start="1.23" dur="2.34">...</text>  (초 단위)
// srv3 포맷: <p t="1230" d="2340">...</p>              (밀리초 단위)
function parseXml(xml: string): { start: number; dur: number; text: string }[] {
  let m: RegExpExecArray | null

  // srv1 시도
  const srv1 = /<text[^>]*\bstart="([\d.]+)"[^>]*\bdur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  const srv1Lines: { start: number; dur: number; text: string }[] = []
  while ((m = srv1.exec(xml)) !== null) {
    const text = cleanXmlText(m[3])
    if (text) srv1Lines.push({ start: Number(m[1]), dur: Number(m[2]), text })
  }
  if (srv1Lines.length > 0) return srv1Lines

  // srv3 시도 — t/d 속성 순서 무관
  const srv3 = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  const srv3Lines: { start: number; dur: number; text: string }[] = []
  while ((m = srv3.exec(xml)) !== null) {
    const attrs = m[1]
    const tMatch = /\bt="(\d+)"/.exec(attrs)
    const dMatch = /\bd="(\d+)"/.exec(attrs)
    if (!tMatch || !dMatch) continue
    const text = cleanXmlText(m[2])
    if (text) srv3Lines.push({ start: Number(tMatch[1]) / 1000, dur: Number(dMatch[1]) / 1000, text })
  }
  return srv3Lines
}

const CAPTION_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

type CaptionResult = { lines: ReturnType<typeof parseJson3>; format: string } | { error: string }

async function tryFetch(url: string): Promise<CaptionResult> {
  const res = await fetch(url, { headers: CAPTION_HEADERS })
  if (!res.ok) return { error: `HTTP ${res.status}` }

  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) return { error: 'empty' }

  if (trimmed.startsWith('{')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(trimmed)
      const lines = parseJson3(data.events)
      if (lines.length > 0) return { lines, format: 'json3' }
      return { error: `json3 이벤트 없음` }
    } catch {
      return { error: `JSON 파싱 실패: ${trimmed.slice(0, 100)}` }
    }
  }

  if (trimmed.startsWith('<')) {
    const lines = parseXml(trimmed)
    if (lines.length > 0) return { lines, format: 'xml' }
    return { error: `XML 파싱 결과 없음: ${trimmed.slice(0, 300)}` }
  }

  return { error: `알 수 없는 응답: ${trimmed.slice(0, 100)}` }
}

async function fetchCaption(baseUrl: string): Promise<CaptionResult> {
  // 1차: baseUrl 그대로 (이미 fmt + 서명 포함)
  const r1 = await tryFetch(baseUrl)
  if (!('error' in r1)) return r1

  // 2차: baseUrl에 fmt=json3 명시 (fmt 없는 URL용)
  const r2 = await tryFetch(`${baseUrl}&fmt=json3`)
  if (!('error' in r2)) return r2

  // 3차: srv1 XML 시도
  const r3 = await tryFetch(`${baseUrl}&fmt=srv1`)
  if (!('error' in r3)) return r3

  return { error: `자막 URL 접근 실패 — 1차: ${r1.error} / 2차: ${r2.error} / 3차: ${r3.error}` }
}

export async function onRequestGet({ request }: { request: Request }) {
  const { searchParams } = new URL(request.url)
  const videoId = searchParams.get('v')
  const lang = searchParams.get('lang') ?? 'en'

  if (!videoId) {
    return Response.json({ error: 'Missing video ID' }, { status: 400 })
  }

  try {
    // YouTube 페이지에서 captionTracks 목록 추출
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!pageRes.ok) {
      return Response.json(
        { lines: [], languages: [], error: `영상 페이지를 불러올 수 없어요. (${pageRes.status})` },
        { status: 502 },
      )
    }

    const html = await pageRes.text()
    const tracksMatch = html.match(/"captionTracks":(\[.*?\])/)

    if (!tracksMatch) {
      return Response.json({ lines: [], languages: [], error: '이 영상에는 자막이 없어요.' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracks: any[] = JSON.parse(tracksMatch[1])

    // 요청 언어 → 언어 prefix → 첫 번째 트랙 순으로 fallback
    const track =
      tracks.find((t) => t.languageCode === lang) ??
      tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
      tracks[0]

    if (!track) {
      return Response.json({ lines: [], languages: [], error: '자막 트랙을 찾을 수 없어요.' })
    }

    const result = await fetchCaption(track.baseUrl)
    if ('error' in result) {
      return Response.json({ lines: [], languages: [], error: result.error }, { status: 502 })
    }

    return Response.json(
      {
        lines: result.lines,
        languages: tracks.map((t) => ({
          code: t.languageCode,
          name: t.name?.simpleText ?? t.languageCode,
          isAuto: t.kind === 'asr',
        })),
        selectedLang: track.languageCode,
      },
      { headers: { 'Access-Control-Allow-Origin': '*' } },
    )
  } catch (e) {
    return Response.json({ lines: [], languages: [], error: String(e) }, { status: 500 })
  }
}
