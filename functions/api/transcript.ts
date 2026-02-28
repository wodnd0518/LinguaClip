// Cloudflare Pages Function — YouTube 자막 프록시
// YouTube InnerTube API 사용 (영상 하단 "스크립트 표시" 버튼과 동일한 방식)

// proto 직렬화:
//   field 1 (string) = videoId
//   field 2 (string) = "" (required)
//   field 5 (string) = "" (required)
function buildParams(videoId: string): string {
  const bytes = new TextEncoder().encode(videoId)
  const proto = new Uint8Array([
    0x0a, bytes.length, ...bytes, // field 1: videoId
    0x12, 0x00,                   // field 2: ""
    0x2a, 0x00,                   // field 5: ""
  ])
  let bin = ''
  proto.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSegments(data: any): { start: number; dur: number; text: string }[] {
  try {
    const segments =
      data?.actions?.[0]?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer
        ?.body?.transcriptSegmentListRenderer?.initialSegments ?? []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return segments.flatMap((seg: any) => {
      const r = seg?.transcriptSegmentRenderer
      if (!r) return []
      const text = (r.snippet?.runs ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((run: any) => run.text)
        .join('')
        .trim()
      if (!text) return []
      const startMs = Number(r.startMs ?? 0)
      const endMs = Number(r.endMs ?? startMs)
      return [{ start: startMs / 1000, dur: (endMs - startMs) / 1000, text }]
    })
  } catch {
    return []
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
    // 1단계: YouTube 페이지에서 INNERTUBE_API_KEY + visitorData 추출
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!pageRes.ok) {
      return Response.json(
        { lines: [], languages: [], error: `영상 페이지 오류 (${pageRes.status})` },
        { status: 502 },
      )
    }

    const html = await pageRes.text()

    // InnerTube API 키 (페이지에 항상 최신 키가 포함됨)
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
    const apiKey = apiKeyMatch?.[1] ?? ''

    // visitorData (세션 식별자)
    const visitorDataMatch = html.match(/"visitorData":"([^"]+)"/)
    const visitorData = visitorDataMatch?.[1] ?? ''

    // clientVersion
    const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)
    const clientVersion = clientVersionMatch?.[1] ?? '2.20240101.01.00'

    if (!apiKey) {
      return Response.json(
        { lines: [], languages: [], error: 'YouTube 페이지에서 API 키를 찾을 수 없어요.' },
        { status: 502 },
      )
    }

    // 2단계: InnerTube get_transcript 호출
    const params = buildParams(videoId)

    const transcriptRes = await fetch(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion,
              hl: lang,
              gl: 'US',
              ...(visitorData ? { visitorData } : {}),
            },
          },
          params,
        }),
      },
    )

    if (!transcriptRes.ok) {
      const body = await transcriptRes.text()
      return Response.json(
        {
          lines: [],
          languages: [],
          error: `InnerTube 오류 (${transcriptRes.status}): ${body.slice(0, 200)}`,
        },
        { status: 502 },
      )
    }

    const text = await transcriptRes.text()
    if (!text.trim()) {
      return Response.json(
        { lines: [], languages: [], error: 'InnerTube 응답이 비어있어요.' },
        { status: 502 },
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      return Response.json(
        { lines: [], languages: [], error: `JSON 파싱 실패: ${text.slice(0, 120)}` },
        { status: 502 },
      )
    }

    const lines = parseSegments(data)
    if (lines.length === 0) {
      const preview = JSON.stringify(data).slice(0, 400)
      return Response.json(
        { lines: [], languages: [], error: `세그먼트 없음: ${preview}` },
        { status: 502 },
      )
    }

    return Response.json(
      {
        lines,
        languages: [{ code: lang, name: lang.toUpperCase() }],
        selectedLang: lang,
      },
      { headers: { 'Access-Control-Allow-Origin': '*' } },
    )
  } catch (e) {
    return Response.json({ lines: [], languages: [], error: String(e) }, { status: 500 })
  }
}
