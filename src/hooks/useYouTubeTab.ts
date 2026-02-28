import { useCallback, useEffect, useRef, useState } from 'react'
import { IS_EXT } from '../lib/env'

export interface VideoInfo {
  videoId: string
  currentTime: number
  duration: number
  paused: boolean
  title: string
}

export function useYouTubeTab() {
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [isOnYouTube, setIsOnYouTube] = useState(false)
  const tabIdRef = useRef<number | null>(null)

  const poll = useCallback(() => {
    if (!IS_EXT) return

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return
      const tab = tabs[0]
      if (!tab?.id || !tab.url?.includes('youtube.com/watch')) {
        setIsOnYouTube(false)
        setVideoInfo(null)
        tabIdRef.current = null
        return
      }

      tabIdRef.current = tab.id
      setIsOnYouTube(true)

      chrome.tabs.sendMessage(tab.id, { type: 'YT_GET_INFO' }, (response) => {
        if (chrome.runtime.lastError) return // 콘텐츠 스크립트 아직 미준비
        if (response) setVideoInfo(response as VideoInfo)
      })
    })
  }, [])

  useEffect(() => {
    if (!IS_EXT) return
    poll()
    const id = setInterval(poll, 1000)
    return () => clearInterval(id)
  }, [poll])

  const seekTo = useCallback((seconds: number) => {
    if (!IS_EXT || !tabIdRef.current) return
    chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_SEEK', seconds }, () => {
      if (chrome.runtime.lastError) {
        // 탭이 닫혔거나 콘텐츠 스크립트가 없음 — 무시
      }
    })
  }, [])

  const navigateTab = useCallback((videoId: string, timestamp: number) => {
    if (!IS_EXT) return
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (tab?.id) {
        chrome.tabs.update(tab.id, {
          url: `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(timestamp)}`,
        })
      }
    })
  }, [])

  const getSubtitle = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (!IS_EXT || !tabIdRef.current) return resolve('')
      chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_GET_SUBTITLE' }, (response) => {
        if (chrome.runtime.lastError) return resolve('')
        resolve((response?.text as string) ?? '')
      })
    })
  }, [])

  const captureSubtitle = useCallback((): Promise<{ text: string; startTime: number }> => {
    return new Promise((resolve) => {
      if (!IS_EXT || !tabIdRef.current) return resolve({ text: '', startTime: 0 })
      chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_CAPTURE_SENTENCE' }, (response) => {
        if (chrome.runtime.lastError) return resolve({ text: '', startTime: 0 })
        resolve(response ?? { text: '', startTime: 0 })
      })
    })
  }, [])

  const resumeVideo = useCallback(() => {
    if (!IS_EXT || !tabIdRef.current) return
    chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_PLAY' }, () => {
      if (chrome.runtime.lastError) { /* 탭이 닫혔거나 content script 없음 */ }
    })
  }, [])

  // 쉐도잉: from 시점부터 duration초간 재생 후 자동 정지
  const playShadow = useCallback((from: number, duration = 7) => {
    if (!IS_EXT || !tabIdRef.current) return
    chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_PLAY_SEGMENT', from, duration }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    })
  }, [])

  return { videoInfo, isOnYouTube, seekTo, navigateTab, getSubtitle, captureSubtitle, resumeVideo, playShadow }
}
