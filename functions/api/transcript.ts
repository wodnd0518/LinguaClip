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

    const captionRes = await fetch(`${track.baseUrl}&fmt=json3`)
    if (!captionRes.ok) {
      return Response.json({ lines: [], languages: [], error: '자막 데이터를 불러올 수 없어요.' }, { status: 502 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await captionRes.json()

    return Response.json(
      {
        lines: parseJson3(data.events),
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
