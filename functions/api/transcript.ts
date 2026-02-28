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

function parseSrv3(xml: string) {
  const lines: { start: number; dur: number; text: string }[] = []
  // <p t="시작ms" d="지속ms" ...>텍스트</p> 패턴
  const re = /<p[^>]+\bt="(\d+)"[^>]+\bd="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    // HTML 태그 및 엔티티 제거
    const text = m[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim()
    if (text) lines.push({ start: Number(m[1]) / 1000, dur: Number(m[2]) / 1000, text })
  }
  return lines
}

async function fetchCaption(baseUrl: string): Promise<{ lines: ReturnType<typeof parseJson3>; format: string } | { error: string }> {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  }

  // 1차 시도: json3 포맷
  const json3Res = await fetch(`${baseUrl}&fmt=json3`, { headers })
  if (json3Res.ok) {
    const text = await json3Res.text()
    const trimmed = text.trim()
    if (trimmed) {
      if (trimmed.startsWith('{')) {
        // JSON 응답
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data: any = JSON.parse(trimmed)
          return { lines: parseJson3(data.events), format: 'json3' }
        } catch {
          // JSON 파싱 실패 → XML fallback
        }
      } else if (trimmed.startsWith('<')) {
        // YouTube가 XML로 응답한 경우 (자동 생성 자막 등)
        const lines = parseSrv3(trimmed)
        if (lines.length > 0) return { lines, format: 'json3-xml' }
      }
    }
  }

  // 2차 시도: srv3 XML 포맷
  const srv3Res = await fetch(`${baseUrl}&fmt=srv3`, { headers })
  if (srv3Res.ok) {
    const xml = await srv3Res.text()
    if (xml.trim()) {
      const lines = parseSrv3(xml.trim())
      if (lines.length > 0) return { lines, format: 'srv3' }
      // XML은 왔지만 파싱된 줄이 없는 경우 — 처음 300자를 디버그로 반환
      return { error: `XML 파싱 결과 없음: ${xml.slice(0, 300)}` }
    }
  }

  return { error: '자막 데이터를 불러올 수 없어요. (json3/srv3 모두 실패)' }
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
      return Response.json({ lines: [], languages: [], error: `영상 페이지를 불러올 수 없어요. (${pageRes.status})` }, { status: 502 })
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
