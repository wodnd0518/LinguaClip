// Cloudflare Pages Function — YouTube 자막 프록시
// YouTube InnerTube API를 사용 (영상 하단 "스크립트 표시" 버튼과 동일한 방식)

const YT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-YouTube-Client-Name': '1',
  'X-YouTube-Client-Version': '2.20240101.00.00',
  Origin: 'https://www.youtube.com',
  Referer: 'https://www.youtube.com/',
}

// proto 직렬화: field 1 (string) = videoId
function buildParams(videoId: string): string {
  const bytes = new TextEncoder().encode(videoId)
  const proto = new Uint8Array([0x0a, bytes.length, ...bytes])
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
    const params = buildParams(videoId)

    const res = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST',
      headers: YT_HEADERS,
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: lang,
            gl: 'US',
          },
        },
        params,
      }),
    })

    if (!res.ok) {
      return Response.json(
        { lines: [], languages: [], error: `InnerTube 오류 (${res.status})` },
        { status: 502 },
      )
    }

    const text = await res.text()
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
        { lines: [], languages: [], error: `InnerTube 파싱 실패: ${text.slice(0, 120)}` },
        { status: 502 },
      )
    }

    const lines = parseSegments(data)
    if (lines.length === 0) {
      // 디버그: 응답 구조 일부 반환
      const preview = JSON.stringify(data).slice(0, 300)
      return Response.json(
        { lines: [], languages: [], error: `자막 세그먼트 없음: ${preview}` },
        { status: 502 },
      )
    }

    return Response.json(
      {
        lines,
        // InnerTube는 언어 목록을 별도로 제공하지 않으므로 현재 언어만 반환
        languages: [{ code: lang, name: lang.toUpperCase() }],
        selectedLang: lang,
      },
      { headers: { 'Access-Control-Allow-Origin': '*' } },
    )
  } catch (e) {
    return Response.json({ lines: [], languages: [], error: String(e) }, { status: 500 })
  }
}
