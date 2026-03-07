// Service worker — 확장 아이콘 클릭 시 사이드 패널 열기
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(console.error)
  }
})

type TranscriptLine = { start: number; dur: number; text: string }

interface CaptionSegment {
  tStartMs: number
  dDurationMs?: number
  segs?: { utf8: string }[]
}

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

// ── get_transcript 응답 파싱 ───────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGetTranscriptData(data: any): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(obj: any): string | null {
    if (!obj || typeof obj !== 'object') return null
    if ('cueGroups' in obj) return 'found'
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) { for (const i of v) { if (walk(i)) return 'found' } }
      else if (walk(v)) return 'found'
    }
    return null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractCues(obj: any) {
    if (!obj || typeof obj !== 'object') return
    if ('cueGroups' in obj && Array.isArray(obj.cueGroups)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const group of obj.cueGroups) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cues: any[] = group?.transcriptCueGroupRenderer?.cues ?? []
        for (const cue of cues) {
          const r = cue?.transcriptCueRenderer
          if (!r) continue
          const text = (
            r.cue?.simpleText ??
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            r.cue?.runs?.map((x: any) => x.text).join('') ?? ''
          ).replace(/\n/g, ' ').trim()
          const start = parseInt(r.startOffsetMs, 10)
          const dur = parseInt(r.durationMs, 10)
          if (text && !isNaN(start)) lines.push({ start: start / 1000, dur: isNaN(dur) ? 3 : dur / 1000, text })
        }
      }
      return
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) { for (const i of v) extractCues(i) }
      else extractCues(v)
    }
  }
  if (walk(data)) extractCues(data)
  return lines
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
      // ── Step 1: 페이지에서 InnerTube 인증 정보 + transcript params 추출 ──
      const pageInfo = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [lang],
        func: (langCode: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ytCfg = (window as any).yt?.config_ ?? {}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ipr = (window as any).ytInitialPlayerResponse
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ytData = (window as any).ytInitialData

          // captionTracks (URL + kind 정보)
          const rawTracks = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tracks = rawTracks.map((t: any) => ({
            baseUrl: t.baseUrl as string,
            languageCode: t.languageCode as string,
            name: t.name,
            kind: t.kind,
          }))

          // ytInitialData에서 getTranscriptEndpoint.params 재귀 탐색
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          function findTranscriptParams(obj: any): string | null {
            if (!obj || typeof obj !== 'object') return null
            if ('getTranscriptEndpoint' in obj) return obj.getTranscriptEndpoint?.params ?? null
            for (const v of Object.values(obj)) {
              const f = Array.isArray(v)
                ? v.reduce((a: string | null, i) => a ?? findTranscriptParams(i), null)
                : findTranscriptParams(v)
              if (f) return f
            }
            return null
          }

          const transcriptParams = findTranscriptParams(ytData)

          // 선택된 트랙 baseUrl (fetch 없이 URL만 반환)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const track: any =
            tracks.find((t: { languageCode: string }) => t.languageCode === langCode) ??
            tracks.find((t: { languageCode: string }) => t.languageCode.startsWith(langCode.split('-')[0])) ??
            tracks[0]

          return {
            apiKey: ytCfg.INNERTUBE_API_KEY as string ?? '',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            context: ytCfg.INNERTUBE_CONTEXT as any ?? null,
            visitorData: ytCfg.VISITOR_DATA as string ?? '',
            transcriptParams: transcriptParams ?? null,
            tracks,
            selectedTrack: track ?? null,
          }
        },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pi = pageInfo[0]?.result as any
      diag.push(`key:${pi?.apiKey ? 'ok' : 'none'}, ctx:${pi?.context ? 'ok' : 'none'}, tp:${pi?.transcriptParams ? 'ok' : 'none'}, tracks:${pi?.tracks?.length ?? 0}`)
      console.log('[LC] pageInfo:', JSON.stringify({ key: !!pi?.apiKey, ctx: !!pi?.context, tp: !!pi?.transcriptParams, tracks: pi?.tracks?.length }))

      let lines: TranscriptLine[] | null = null

      // ── Approach A: get_transcript with 페이지 실제 API key ──
      if (!lines && pi?.apiKey && pi?.context && pi?.transcriptParams) {
        try {
          const apiKey = pi.apiKey as string
          const url = `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              'x-youtube-client-name': String(pi.context?.client?.clientName === 'WEB' ? '1' : pi.context?.client?.clientName ?? '1'),
              'x-youtube-client-version': String(pi.context?.client?.clientVersion ?? ''),
              ...(pi.visitorData ? { 'x-goog-visitor-id': pi.visitorData } : {}),
            },
            body: JSON.stringify({
              context: pi.context,
              params: pi.transcriptParams,
            }),
          })
          const text = res.ok ? await res.text() : ''
          diag.push(`gt_A:${res.status}/${text.length}`)
          console.log('[LC] get_transcript A:', res.status, text.length)
          if (text.trim()) {
            const parsed = parseGetTranscriptData(JSON.parse(text))
            if (parsed.length > 0) lines = parsed
          }
        } catch (e) { diag.push(`gt_A_err:${String(e).slice(0, 20)}`); console.log('[LC] gt_A error:', e) }
      }

      // ── Approach B: /next → params → get_transcript (api key 사용) ──
      if (!lines && pi?.apiKey && pi?.context) {
        try {
          const apiKey = pi.apiKey as string
          const headers = {
            'content-type': 'application/json',
            'x-youtube-client-name': '1',
            'x-youtube-client-version': String(pi.context?.client?.clientVersion ?? '2.20250101.00.00'),
            ...(pi.visitorData ? { 'x-goog-visitor-id': pi.visitorData } : {}),
          }
          const nextRes = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}&prettyPrint=false`, {
            method: 'POST', credentials: 'include', headers,
            body: JSON.stringify({ videoId, context: pi.context }),
          })
          const nextText = nextRes.ok ? await nextRes.text() : ''
          diag.push(`next:${nextRes.status}/${nextText.length}`)
          if (nextText.trim()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            function findTp(obj: any): string | null {
              if (!obj || typeof obj !== 'object') return null
              if ('getTranscriptEndpoint' in obj) return obj.getTranscriptEndpoint?.params ?? null
              for (const v of Object.values(obj)) {
                const f = Array.isArray(v) ? v.reduce((a: string|null, i) => a ?? findTp(i), null) : findTp(v)
                if (f) return f
              }
              return null
            }
            const params = findTp(JSON.parse(nextText))
            diag.push(`tp_B:${params ? 'ok' : 'none'}`)
            if (params) {
              const gtRes = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, {
                method: 'POST', credentials: 'include', headers,
                body: JSON.stringify({ context: pi.context, params }),
              })
              const gtText = gtRes.ok ? await gtRes.text() : ''
              diag.push(`gt_B:${gtRes.status}/${gtText.length}`)
              if (gtText.trim()) {
                const parsed = parseGetTranscriptData(JSON.parse(gtText))
                if (parsed.length > 0) lines = parsed
              }
            }
          }
        } catch (e) { diag.push(`gt_B_err:${String(e).slice(0, 20)}`); console.log('[LC] gt_B error:', e) }
      }

      // ── Approach C: caption URL fetch (timedtext) ──────────────
      if (!lines && pi?.selectedTrack) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const track: any = pi.selectedTrack
        const base = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(track.languageCode)}`
        const kp = track.kind ? `&kind=${track.kind}` : ''
        const primary = track.baseUrl?.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`

        const urls: [string, boolean][] = [
          [primary, true],
          [`${base}${kp}&fmt=json3`, true],
          [`${base}&fmt=json3`, true],
          [`${base}${kp}`, false],
        ]
        for (const [url, isJson3] of urls) {
          try {
            const res = await fetch(url, { credentials: 'include' })
            const text = res.ok ? await res.text() : ''
            diag.push(`tt:${res.status}/${text.length}`)
            if (!text.trim()) continue
            const parsed = isJson3
              ? parseJson3((JSON.parse(text) as { events: CaptionSegment[] }).events)
              : parseXmlCaptions(text)
            if (parsed.length > 0) { lines = parsed; break }
          } catch { continue }
        }
      }

      if (!lines || lines.length === 0) {
        console.log('[LC] all failed:', diag.join(', '))
        sendResponse({ error: `자막을 불러올 수 없어요. [${diag.join(', ')}]`, lines: [] })
        return
      }

      // ── 언어 목록 ─────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allTracks: any[] = pi?.tracks ?? []
      const languages = allTracks.map((t) => ({
        code: t.languageCode,
        name: t.name?.simpleText ?? t.languageCode,
        isAuto: t.kind === 'asr',
      }))
      const selectedLang = pi?.selectedTrack?.languageCode ?? lang

      console.log('[LC] success:', lines.length, 'lines', diag.join(', '))
      sendResponse({ lines, languages: languages.length > 0 ? languages : [{ code: lang, name: lang, isAuto: false }], selectedLang })
    } catch (e) {
      console.log('[LC] fatal error:', e, diag.join(', '))
      sendResponse({ error: `오류: ${String(e)} [${diag.join(', ')}]`, lines: [] })
    }
  })

  return true
})
