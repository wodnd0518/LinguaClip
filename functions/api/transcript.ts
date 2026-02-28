// Cloudflare Pages Function — YouTube 자막 프록시
// youtube-transcript-api 방식: 페이지 쿠키를 자막 요청에 포워딩

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
      text: (e.segs ?? []).map((s) => s.utf8).join('').replace(/\n/g, ' ').trim(),
    }))
    .filter((l) => l.text)
}

function cleanXml(s: string) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n/g, ' ').trim()
}

// srv1: <text start="1.23" dur="2.34">...</text>
// srv3: <p t="1230" d="2340"><s>...</s></p>
function parseXml(xml: string): { start: number; dur: number; text: string }[] {
  let m: RegExpExecArray | null

  const srv1 = /<text[^>]*\bstart="([\d.]+)"[^>]*\bdur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  const srv1Lines: { start: number; dur: number; text: string }[] = []
  while ((m = srv1.exec(xml)) !== null) {
    const text = cleanXml(m[3])
    if (text) srv1Lines.push({ start: Number(m[1]), dur: Number(m[2]), text })
  }
  if (srv1Lines.length > 0) return srv1Lines

  const srv3 = /<p\b([^>]*)>([\s\S]*?)<\/p>/g
  const srv3Lines: { start: number; dur: number; text: string }[] = []
  while ((m = srv3.exec(xml)) !== null) {
    const tM = /\bt="(\d+)"/.exec(m[1])
    const dM = /\bd="(\d+)"/.exec(m[1])
    if (!tM || !dM) continue
    const text = cleanXml(m[2])
    if (text) srv3Lines.push({ start: Number(tM[1]) / 1000, dur: Number(dM[1]) / 1000, text })
  }
  return srv3Lines
}

// 페이지 응답 Set-Cookie → Cookie 헤더 문자열 변환
function buildCookieHeader(headers: Headers): string {
  const map = new Map<string, string>()
  // GDPR 동의 쿠키 (서버에서 접근 시 필요)
  map.set('CONSENT', 'YES+cb')
  map.set('GPS', '1')

  const raw = headers.get('set-cookie') ?? ''
  // Fetch API는 Set-Cookie를 콤마로 합쳐서 반환 — "name=val; opts, name2=val2; opts" 형태
  // 쿠키 값에 콤마가 없다고 가정하고 ', ' 로 분리
  for (const chunk of raw.split(/,\s+/)) {
    const nameValue = chunk.split(';')[0].trim()
    const eq = nameValue.indexOf('=')
    if (eq < 1) continue
    const name = nameValue.slice(0, eq).trim()
    const value = nameValue.slice(eq + 1).trim()
    if (name) map.set(name, value)
  }

  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function fetchCaption(
  baseUrl: string,
  cookieHeader: string,
): Promise<{ lines: ReturnType<typeof parseJson3>; format: string } | { error: string }> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: cookieHeader,
  }

  // baseUrl 그대로 (이미 fmt + 서명 포함)
  const res = await fetch(baseUrl, { headers })
  const status = res.status

  if (!res.ok) return { error: `HTTP ${status}` }

  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) return { error: `빈 응답 (${status}) — 쿠키 포워딩 후에도 비어있음` }

  if (trimmed.startsWith('{')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(trimmed)
      const lines = parseJson3(data.events)
      if (lines.length > 0) return { lines, format: 'json3' }
      return { error: 'json3 이벤트 없음' }
    } catch {
      return { error: `JSON 파싱 실패: ${trimmed.slice(0, 100)}` }
    }
  }

  if (trimmed.startsWith('<')) {
    const lines = parseXml(trimmed)
    if (lines.length > 0) return { lines, format: 'xml' }
    return { error: `XML 파싱 결과 없음: ${trimmed.slice(0, 300)}` }
  }

  return { error: `알 수 없는 응답: ${trimmed.slice(0, 150)}` }
}

export async function onRequestGet({ request }: { request: Request }) {
  const { searchParams } = new URL(request.url)
  const videoId = searchParams.get('v')
  const lang = searchParams.get('lang') ?? 'en'

  if (!videoId) {
    return Response.json({ error: 'Missing video ID' }, { status: 400 })
  }

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb; GPS=1',
      },
    })

    if (!pageRes.ok) {
      return Response.json(
        { lines: [], languages: [], error: `페이지 오류 (${pageRes.status})` },
        { status: 502 },
      )
    }

    const html = await pageRes.text()

    // 페이지 Set-Cookie → 다음 요청에 포워딩
    const cookieHeader = buildCookieHeader(pageRes.headers)

    const tracksMatch = html.match(/"captionTracks":(\[.*?\])/)
    if (!tracksMatch) {
      return Response.json({ lines: [], languages: [], error: '이 영상에는 자막이 없어요.' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracks: any[] = JSON.parse(tracksMatch[1])

    const track =
      tracks.find((t) => t.languageCode === lang) ??
      tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
      tracks[0]

    if (!track) {
      return Response.json({ lines: [], languages: [], error: '자막 트랙을 찾을 수 없어요.' })
    }

    const result = await fetchCaption(track.baseUrl, cookieHeader)
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
