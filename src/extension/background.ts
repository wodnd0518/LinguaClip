// Service worker — 확장 아이콘 클릭 시 사이드 패널 열기
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error)
  }
})

interface CaptionTrack {
  baseUrl: string
  languageCode: string
  name?: { simpleText?: string }
  kind?: string
}

interface CaptionSegment {
  tStartMs: number
  dDurationMs?: number
  segs?: { utf8: string }[]
}

type TranscriptLine = { start: number; dur: number; text: string }

function parseJson3(events: CaptionSegment[]): TranscriptLine[] {
  return (events ?? [])
    .filter((e) => (e.segs?.length ?? 0) > 0)
    .map((e) => ({
      start: e.tStartMs / 1000,
      dur: (e.dDurationMs ?? 0) / 1000,
      text: (e.segs ?? []).map((s) => s.utf8).join('').replace(/\n/g, ' ').trim(),
    }))
    .filter((l) => l.text)
}

// Service worker에 DOMParser 없음 → regex
function parseXmlCaptions(xml: string): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  const re = /<text[^>]+start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const text = m[3]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#\d+;/g, '')
      .replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
    if (text) lines.push({ start: parseFloat(m[1]), dur: parseFloat(m[2]), text })
  }
  return lines
}

// ── 재귀 탐색 헬퍼 ──────────────────────────────────────────
function findKey<T>(obj: unknown, key: string): T | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (key in o) return o[key] as T
  for (const v of Object.values(o)) {
    const found = findKey<T>(Array.isArray(v) ? { _: v } : v, key)
    if (found !== null) return found
    if (Array.isArray(v)) {
      for (const item of v) {
        const f = findKey<T>(item, key)
        if (f !== null) return f
      }
    }
  }
  return null
}

// ── Approach 1: ANDROID InnerTube 클라이언트 ────────────────
// POT(Proof of Origin Token) 불필요 — WEB 클라이언트만 POT 요구
async function getTracksViaAndroid(videoId: string): Promise<CaptionTrack[] | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        videoId,
        context: {
          client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 },
        },
      }),
    })
    if (!res.ok) { console.log('[LC] ANDROID player', res.status); return null }
    const data = await res.json()
    const raw = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
    if (!Array.isArray(raw) || raw.length === 0) { console.log('[LC] ANDROID: no tracks'); return null }
    console.log('[LC] ANDROID: tracks', raw.length, raw.map((t: CaptionTrack) => `${t.languageCode}/${t.kind}`))
    return raw as CaptionTrack[]
  } catch (e) { console.log('[LC] ANDROID error:', e); return null }
}

// ── Approach 2: get_transcript InnerTube API ─────────────────
// timedtext API 완전 우회 — 직접 transcript JSON 반환
async function getTranscriptViaInnerTube(videoId: string, lang: string): Promise<TranscriptLine[] | null> {
  try {
    const CLIENT = { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: lang, gl: 'US' }
    const headers = {
      'content-type': 'application/json',
      'x-youtube-client-name': '1',
      'x-youtube-client-version': CLIENT.clientVersion,
    }

    // Step 1: /next 에서 getTranscriptEndpoint.params 추출
    const nextRes = await fetch('https://www.youtube.com/youtubei/v1/next', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ videoId, context: { client: CLIENT } }),
    })
    if (!nextRes.ok) { console.log('[LC] /next', nextRes.status); return null }
    const nextData = await nextRes.json()

    const params = findKey<string>(nextData, 'getTranscriptEndpoint') as unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paramsStr = (params as any)?.params as string | undefined
    if (!paramsStr) { console.log('[LC] get_transcript: params not found'); return null }

    // Step 2: /get_transcript
    const tRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: CLIENT.clientVersion } }, params: paramsStr }),
    })
    if (!tRes.ok) { console.log('[LC] get_transcript', tRes.status); return null }
    const tData = await tRes.json()

    // cueGroups 파싱
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cueGroups = findKey<any[]>(tData, 'cueGroups')
    if (!Array.isArray(cueGroups) || cueGroups.length === 0) { console.log('[LC] get_transcript: no cueGroups'); return null }

    const lines: TranscriptLine[] = []
    for (const group of cueGroups) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cues: any[] = group?.transcriptCueGroupRenderer?.cues ?? []
      for (const cue of cues) {
        const r = cue?.transcriptCueRenderer
        if (!r) continue
        const text = (r.cue?.simpleText ?? r.cue?.runs?.map((x: { text: string }) => x.text).join('') ?? '').replace(/\n/g, ' ').trim()
        const start = parseInt(r.startOffsetMs, 10)
        const dur = parseInt(r.durationMs, 10)
        if (text && !isNaN(start) && !isNaN(dur)) lines.push({ start: start / 1000, dur: dur / 1000, text })
      }
    }
    console.log('[LC] get_transcript: lines', lines.length)
    return lines.length > 0 ? lines : null
  } catch (e) { console.log('[LC] get_transcript error:', e); return null }
}

// ── 언어 선택 ──────────────────────────────────────────────
function selectTrack(tracks: CaptionTrack[], lang: string): CaptionTrack {
  return (
    tracks.find((t) => t.languageCode === lang) ??
    tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
    tracks[0]
  )
}

// ── caption URL → text ────────────────────────────────────
async function fetchCaptionText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    const text = res.ok ? await res.text() : ''
    console.log(`[LC] caption fetch ${res.status} len=${text.length}`, url.replace(/^https:\/\/[^?]+\?/, '').slice(0, 60))
    return text
  } catch (e) { console.log('[LC] caption fetch error:', e); return '' }
}

// ── 메인 메시지 핸들러 ────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'YT_GET_TRANSCRIPT') return false

  const videoId = message.videoId as string
  const lang = (message.lang as string | undefined) ?? 'en'

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) { sendResponse({ error: 'YouTube 탭을 찾을 수 없어요.', lines: [] }); return }

    const diag: string[] = []

    try {
      // ── Approach 1: ANDROID InnerTube → captionUrl fetch ──────
      let lines: TranscriptLine[] | null = null
      let allTracks: CaptionTrack[] | null = null

      const androidTracks = await getTracksViaAndroid(videoId)
      diag.push(`android:${androidTracks?.length ?? 0}트랙`)

      if (androidTracks && androidTracks.length > 0) {
        allTracks = androidTracks
        const track = selectTrack(androidTracks, lang)
        const base = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(track.languageCode)}`
        const kindParam = track.kind ? `&kind=${track.kind}` : ''
        const primaryUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`

        const urlsToTry: [string, boolean][] = [
          [primaryUrl, true],
          [`${base}${kindParam}&fmt=json3`, true],
          [`${base}&fmt=json3`, true],
          [`${base}${kindParam}`, false],
        ]

        for (const [url, isJson3] of urlsToTry) {
          const text = await fetchCaptionText(url)
          diag.push(`${isJson3 ? 'j3' : 'xml'}:${text.length}`)
          if (!text.trim()) continue
          try {
            const parsed = isJson3
              ? parseJson3((JSON.parse(text) as { events: CaptionSegment[] }).events)
              : parseXmlCaptions(text)
            if (parsed.length > 0) { lines = parsed; break }
          } catch { continue }
        }
      }

      // ── Approach 2: get_transcript InnerTube API ───────────────
      if (!lines || lines.length === 0) {
        diag.push('→get_transcript')
        const gtLines = await getTranscriptViaInnerTube(videoId, lang)
        diag.push(`gt:${gtLines?.length ?? 0}`)
        if (gtLines && gtLines.length > 0) lines = gtLines
      }

      // ── Approach 3: ytInitialPlayerResponse (page 직접 접근) ──
      if (!lines || lines.length === 0) {
        diag.push('→ipr')
        try {
          const scriptResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            args: [videoId, lang],
            func: async (vid: string, lc: string) => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ipr = (window as any).ytInitialPlayerResponse
                const raw = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
                if (!Array.isArray(raw) || raw.length === 0) return { lines: null, error: 'no tracks' }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const track: any =
                  raw.find((t: { languageCode: string }) => t.languageCode === lc) ??
                  raw.find((t: { languageCode: string }) => t.languageCode.startsWith(lc.split('-')[0])) ??
                  raw[0]
                const url = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`
                const res = await fetch(url)
                const text = await res.text()
                return { lines: null, rawText: text, langCode: track.languageCode, kind: track.kind, videoIdMatch: ipr?.videoDetails?.videoId === vid }
              } catch (e) { return { lines: null, error: String(e) } }
            },
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = scriptResult[0]?.result as any
          diag.push(`ipr_raw:${r?.rawText?.length ?? 0}`)
          if (r?.rawText?.trim()) {
            try {
              lines = parseJson3((JSON.parse(r.rawText) as { events: CaptionSegment[] }).events)
            } catch {
              lines = parseXmlCaptions(r.rawText)
            }
          }
        } catch (e) { diag.push(`ipr_err:${String(e).slice(0, 20)}`) }
      }

      if (!lines || lines.length === 0) {
        sendResponse({ error: `자막을 불러올 수 없어요. [${diag.join(', ')}]`, lines: [] })
        return
      }

      // ── 언어 목록 (ANDROID tracks or fallback) ────────────────
      const languages = (allTracks ?? []).map((t) => ({
        code: t.languageCode,
        name: t.name?.simpleText ?? t.languageCode,
        isAuto: t.kind === 'asr',
      }))
      const selectedLang = allTracks ? selectTrack(allTracks, lang).languageCode : lang

      sendResponse({ lines, languages, selectedLang })
    } catch (e) {
      sendResponse({ error: `오류: ${String(e)} [${diag.join(', ')}]`, lines: [] })
    }
  })

  return true
})
