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

// Service worker에는 DOMParser 없음 → regex
function parseXmlCaptions(xml: string): { start: number; dur: number; text: string }[] {
  const lines: { start: number; dur: number; text: string }[] = []
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

// background에서 fetch (YouTube 서비스 워커 영향 없음)
// credentials: 'include' → 사용자의 YouTube 쿠키 포함
async function bgFetch(url: string): Promise<{ text: string; status: number }> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    const text = res.ok ? await res.text() : ''
    console.log(`[LC BG] ${res.status} len=${text.length}`, url.replace('https://www.youtube.com/api/timedtext?', '').slice(0, 80))
    return { text, status: res.status }
  } catch (e) {
    console.log('[LC BG] fetch exception:', String(e))
    return { text: '', status: 0 }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'YT_GET_TRANSCRIPT') return false

  const videoId = message.videoId as string
  const lang = (message.lang as string | undefined) ?? 'en'

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0]
    if (!tab?.id) {
      sendResponse({ error: 'YouTube 탭을 찾을 수 없어요.', lines: [] })
      return
    }

    const diagnostics: string[] = []

    try {
      // ── Step 1: ytInitialPlayerResponse에서 트랙 URL 읽기 (fetch 없음) ──
      const scriptResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [videoId],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        func: (_vid: string) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ipr = (window as any).ytInitialPlayerResponse
            const raw = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks
            if (Array.isArray(raw) && raw.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return { tracks: raw.map((t: any) => ({
                baseUrl: t.baseUrl as string,
                languageCode: t.languageCode as string,
                name: t.name as { simpleText?: string } | undefined,
                kind: t.kind as string | undefined,
              })), source: 'ipr' }
            }
          } catch { /* ignore */ }
          return { tracks: null, source: 'none' }
        },
      })

      const iprData = scriptResult[0]?.result as { tracks: CaptionTrack[] | null; source: string } | null
      let tracks: CaptionTrack[] | null = iprData?.tracks ?? null
      diagnostics.push(`ipr:${tracks?.length ?? 0}트랙`)

      // ── Step 2: IPR 실패 시 background에서 timedtext list API ──
      if (!tracks) {
        const { text: listXml, status } = await bgFetch(
          `https://www.youtube.com/api/timedtext?v=${videoId}&type=list`
        )
        diagnostics.push(`list:${status}/${listXml.length}`)
        if (listXml.trim()) {
          const parsed: CaptionTrack[] = []
          const re = /<track\b([^>]*)>/g
          let m: RegExpExecArray | null
          while ((m = re.exec(listXml)) !== null) {
            const attr = (name: string) => m![1].match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? ''
            const langCode = attr('lang_code')
            if (!langCode) continue
            const kind = attr('kind') || undefined
            const name = attr('name')
            const langOriginal = attr('lang_original') || langCode
            const baseUrl =
              `https://www.youtube.com/api/timedtext?v=${videoId}` +
              `&lang=${encodeURIComponent(langCode)}` +
              (kind ? `&kind=${kind}` : '') +
              (name ? `&name=${encodeURIComponent(name)}` : '')
            parsed.push({ baseUrl, languageCode: langCode, name: { simpleText: langOriginal }, kind })
          }
          if (parsed.length > 0) tracks = parsed
          diagnostics.push(`parsed:${tracks?.length ?? 0}트랙`)
        }
      }

      if (!tracks || tracks.length === 0) {
        sendResponse({ error: `자막 없음 [${diagnostics.join(', ')}]`, lines: [] })
        return
      }

      // ── Step 3: 언어 선택 ──
      const track =
        tracks.find((t) => t.languageCode === lang) ??
        tracks.find((t) => t.languageCode.startsWith(lang.split('-')[0])) ??
        tracks[0]

      const base = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${encodeURIComponent(track.languageCode)}`
      const kindParam = track.kind ? `&kind=${track.kind}` : ''
      const primaryUrl = track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`

      const urlsToTry: [string, boolean][] = [
        [primaryUrl, true],
        [`${base}${kindParam}&fmt=json3`, true],
        [`${base}&fmt=json3`, true],
        [`${base}${kindParam}`, false],
        [`${base}`, false],
      ]

      // ── Step 4: background에서 fetch (YouTube SW 우회, 쿠키 포함) ──
      let lines: { start: number; dur: number; text: string }[] | null = null

      for (const [url, isJson3] of urlsToTry) {
        const { text, status } = await bgFetch(url)
        diagnostics.push(`${isJson3 ? 'j3' : 'xml'}:${status}/${text.length}`)
        if (!text.trim()) continue
        try {
          lines = isJson3
            ? parseJson3((JSON.parse(text) as { events: CaptionSegment[] }).events)
            : parseXmlCaptions(text)
          if (lines.length > 0) {
            console.log('[LC BG] ✓ success, lines:', lines.length)
            break
          }
        } catch (e) {
          diagnostics.push(`parse_err:${String(e).slice(0, 30)}`)
        }
      }

      if (!lines || lines.length === 0) {
        sendResponse({
          error: `자막을 불러올 수 없어요. [${diagnostics.join(', ')}]`,
          lines: [],
        })
        return
      }

      sendResponse({
        lines,
        languages: tracks.map((t) => ({
          code: t.languageCode,
          name: t.name?.simpleText ?? t.languageCode,
          isAuto: t.kind === 'asr',
        })),
        selectedLang: track.languageCode,
      })
    } catch (e) {
      sendResponse({ error: `오류: ${String(e)} [${diagnostics.join(', ')}]`, lines: [] })
    }
  })

  return true
})
