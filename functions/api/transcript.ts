// Cloudflare Pages Function — YouTube 자막 메타데이터 프록시
// 서버: YouTube 페이지에서 captionTracks URL 추출만 담당
// 클라이언트: 실제 자막 URL을 브라우저에서 직접 fetch (사용자 IP + 쿠키 사용)

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
        { error: `페이지 오류 (${pageRes.status})` },
        { status: 502 },
      )
    }

    const html = await pageRes.text()
    const tracksMatch = html.match(/"captionTracks":(\[.*?\])/)

    if (!tracksMatch) {
      return Response.json({ error: '이 영상에는 자막이 없어요.' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracks: any[] = JSON.parse(tracksMatch[1])

    const track =
      tracks.find((t) => t.languageCode === lang) ??
      tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
      tracks[0]

    if (!track) {
      return Response.json({ error: '자막 트랙을 찾을 수 없어요.' })
    }

    // signed URL에서 lang/name/kind만 추출 → 서명 없는 단순 URL 구성
    // (브라우저가 직접 fetch하므로 서명 불필요)
    const parsed = new URL(track.baseUrl)
    const trackLang = parsed.searchParams.get('lang') ?? track.languageCode
    const trackName = parsed.searchParams.get('name') ?? track.name?.simpleText ?? ''
    const trackKind = parsed.searchParams.get('kind') ?? track.kind ?? ''

    const captionUrl = new URL('https://www.youtube.com/api/timedtext')
    captionUrl.searchParams.set('v', videoId)
    captionUrl.searchParams.set('lang', trackLang)
    if (trackName) captionUrl.searchParams.set('name', trackName)
    if (trackKind) captionUrl.searchParams.set('kind', trackKind)
    captionUrl.searchParams.set('fmt', 'json3')

    return Response.json(
      {
        captionUrl: captionUrl.toString(),
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
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
