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

const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true'

export interface Clip {
  id: string
  userId: string
  sentence: string
  videoId: string
  timestamp: number // seconds
  endTime?: number  // seconds — 문장 끝 타임스탬프 (쉐도잉 루프용)
  comment?: string
  context?: string       // YouTube 자막 문장 (저장 시점)
  wordTranslation?: string  // 저장된 단어의 한국어 뜻
  createdAt: Timestamp | null
}

let mockIdCounter = 1

export function useClips(userId: string) {
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // — Mock 모드 또는 Firebase 미설정: 로컬 상태 —
    if (MOCK_MODE || !db) {
      setLoading(false)
      return
    }

    // — Firebase Firestore (웹 + 확장 공통) —
    const q = query(
      collection(db, 'users', userId, 'clips'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      setClips(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Clip, 'id'>) })))
      setLoading(false)
    })
    return unsub
  }, [userId])

  async function saveClip(sentence: string, videoId: string, timestamp: number, comment?: string, context?: string, wordTranslation?: string, endTime?: number): Promise<void> {
    if (MOCK_MODE || !db) {
      const newClip: Clip = {
        id: `mock-${mockIdCounter++}`,
        userId,
        sentence,
        videoId,
        timestamp,
        endTime,
        comment,
        context,
        wordTranslation,
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
      ...(endTime !== undefined ? { endTime } : {}),
      ...(comment ? { comment } : {}),
      ...(context ? { context } : {}),
      ...(wordTranslation ? { wordTranslation } : {}),
      createdAt: serverTimestamp(),
    })
  }

  async function deleteClip(clipId: string): Promise<void> {
    if (MOCK_MODE || !db) {
      setClips((prev) => prev.filter((c) => c.id !== clipId))
      return
    }

    await deleteDoc(doc(db, 'users', userId, 'clips', clipId))
  }

  return { clips, loading, saveClip, deleteClip }
}
