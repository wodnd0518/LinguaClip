import { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { IS_EXT } from '../lib/env'

const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true'

export interface Clip {
  id: string
  userId: string
  sentence: string
  videoId: string
  timestamp: number // seconds
  comment?: string
  context?: string  // YouTube 자막 문장 (저장 시점)
  createdAt: Timestamp | null
}

let mockIdCounter = 1

export function useClips(userId: string) {
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)
  const storageKey = `clips_${userId}`

  useEffect(() => {
    // — 확장 프로그램: chrome.storage.local —
    if (IS_EXT) {
      chrome.storage.local.get([storageKey], (result) => {
        setClips((result[storageKey] as Clip[]) ?? [])
        setLoading(false)
      })
      return
    }

    // — Mock 모드 또는 Firebase 미설정: 로컬 상태 —
    if (MOCK_MODE || !db) {
      setLoading(false)
      return
    }

    // — 실제 Firebase Firestore —
    const q = query(
      collection(db, 'users', userId, 'clips'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      setClips(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Clip, 'id'>) })))
      setLoading(false)
    })
    return unsub
  }, [userId, storageKey])

  async function saveClip(sentence: string, videoId: string, timestamp: number, comment?: string, context?: string): Promise<void> {
    if (IS_EXT) {
      const newClip: Clip = {
        id: crypto.randomUUID(),
        userId,
        sentence,
        videoId,
        timestamp,
        comment,
        context,
        createdAt: null,
      }
      const updated = [newClip, ...clips]
      setClips(updated)
      chrome.storage.local.set({ [storageKey]: updated })
      return
    }

    if (MOCK_MODE || !db) {
      const newClip: Clip = {
        id: `mock-${mockIdCounter++}`,
        userId,
        sentence,
        videoId,
        timestamp,
        comment,
        context,
        createdAt: null,
      }
      setClips((prev) => [newClip, ...prev])
      return
    }

    await addDoc(collection(db, 'users', userId, 'clips'), {
      userId,
      sentence,
      videoId,
      timestamp,
      ...(comment ? { comment } : {}),
      ...(context ? { context } : {}),
      createdAt: serverTimestamp(),
    })
  }

  async function deleteClip(clipId: string): Promise<void> {
    if (IS_EXT) {
      const updated = clips.filter((c) => c.id !== clipId)
      setClips(updated)
      chrome.storage.local.set({ [storageKey]: updated })
      return
    }

    if (MOCK_MODE || !db) {
      setClips((prev) => prev.filter((c) => c.id !== clipId))
      return
    }

    await deleteDoc(doc(db, 'users', userId, 'clips', clipId))
  }

  return { clips, loading, saveClip, deleteClip }
}
