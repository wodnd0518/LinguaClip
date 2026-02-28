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

type FetchResult = { lines: ReturnType<typeof parseJson3>; format: string } | { error: string }

async function tryUrl(url: string, cookieHeader: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: cookieHeader,
    },
  })
  if (!res.ok) return { error: `HTTP ${res.status}` }
  const text = (await res.text()).trim()
  if (!text) return { error: `empty` }

  if (text.startsWith('{')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(text)
      const lines = parseJson3(data.events)
      if (lines.length > 0) return { lines, format: 'json3' }
      return { error: 'json3 이벤트 없음' }
    } catch {
      return { error: `JSON 파싱 실패: ${text.slice(0, 100)}` }
    }
  }

  if (text.startsWith('<')) {
    const lines = parseXml(text)
    if (lines.length > 0) return { lines, format: 'xml' }
    return { error: `XML 파싱 결과 없음: ${text.slice(0, 300)}` }
  }

  return { error: `알 수 없는 응답: ${text.slice(0, 120)}` }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCaption(track: any, videoId: string, cookieHeader: string): Promise<FetchResult> {
  // 1차: signed baseUrl 그대로
  const r1 = await tryUrl(track.baseUrl, cookieHeader)
  if (!('error' in r1) || r1.error !== 'empty') return r1

  // 2차: signed URL에서 핵심 파라미터만 추출 → 서명 없는 timedtext URL 재구성
  // Cloudflare IP에서는 서명된 URL이 빈 응답을 반환하므로 unsigned URL을 직접 구성
  try {
    const parsed = new URL(track.baseUrl)
    const lang = parsed.searchParams.get('lang') ?? track.languageCode ?? 'en'
    const name = parsed.searchParams.get('name') ?? track.name?.simpleText ?? ''
    const kind = parsed.searchParams.get('kind') ?? track.kind ?? ''

    const base = new URL('https://www.youtube.com/api/timedtext')
    base.searchParams.set('v', videoId)
    base.searchParams.set('lang', lang)
    if (name) base.searchParams.set('name', name)
    if (kind) base.searchParams.set('kind', kind)

    // json3 시도
    base.searchParams.set('fmt', 'json3')
    const r2 = await tryUrl(base.toString(), cookieHeader)
    if (!('error' in r2)) return r2

    // srv1 XML 시도 (fmt 없이)
    base.searchParams.delete('fmt')
    const r3 = await tryUrl(base.toString(), cookieHeader)
    if (!('error' in r3)) return r3

    return { error: `서명없는 URL도 실패 — json3: ${(r2 as { error: string }).error} / srv1: ${(r3 as { error: string }).error}` }
  } catch (e) {
    return { error: `URL 파싱 오류: ${e}` }
  }
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

    const result = await fetchCaption(track, videoId, cookieHeader)
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
