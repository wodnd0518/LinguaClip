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
  const videoInfoRef = useRef<VideoInfo | null>(null)

  const poll = useCallback(() => {
    if (!IS_EXT) return

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return
      const tab = tabs[0]
      if (!tab?.id || !tab.url?.includes('youtube.com/watch')) {
        setIsOnYouTube(false)
        setVideoInfo(null)
        videoInfoRef.current = null
        tabIdRef.current = null
        return
      }

      tabIdRef.current = tab.id
      setIsOnYouTube(true)

      chrome.tabs.sendMessage(tab.id, { type: 'YT_GET_INFO' }, (response) => {
        if (chrome.runtime.lastError) return // 콘텐츠 스크립트 아직 미준비
        if (response) {
          const info = response as VideoInfo
          setVideoInfo(info)
          videoInfoRef.current = info
        }
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

  const captureSubtitle = useCallback((): Promise<{ text: string; startTime: number; endTime: number; videoId: string }> => {
    return new Promise((resolve) => {
      const empty = { text: '', startTime: 0, endTime: 0, videoId: '' }
      if (!IS_EXT || !tabIdRef.current) return resolve(empty)
      // videoInfoRef로 캡처 시점의 videoId를 고정
      const videoId = videoInfoRef.current?.videoId ?? ''
      chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_CAPTURE_SENTENCE' }, (response) => {
        if (chrome.runtime.lastError) return resolve(empty)
        resolve(response ? { ...(response as { text: string; startTime: number; endTime: number }), videoId } : empty)
      })
    })
  }, [])

  const resumeVideo = useCallback(() => {
    if (!IS_EXT || !tabIdRef.current) return
    chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_PLAY' }, () => {
      if (chrome.runtime.lastError) { /* 탭이 닫혔거나 content script 없음 */ }
    })
  }, [])

  // 쉐도잉: from ~ to 구간 무한 반복
  const startShadow = useCallback((from: number, to: number) => {
    if (!IS_EXT || !tabIdRef.current) return
    chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_START_SHADOW', from, to }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    })
  }, [])

  // 쉐도잉 정지
  const stopShadow = useCallback(() => {
    if (!IS_EXT || !tabIdRef.current) return
    chrome.tabs.sendMessage(tabIdRef.current, { type: 'YT_STOP_SHADOW' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    })
  }, [])

  return { videoInfo, isOnYouTube, seekTo, navigateTab, getSubtitle, captureSubtitle, resumeVideo, startShadow, stopShadow }
}
