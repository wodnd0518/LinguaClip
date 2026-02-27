import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Firebase 프로젝트 설정값은 .env.local 파일에서 불러옵니다.
// Firebase Console > Project Settings > Your apps > SDK setup 에서 복사하세요.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// apiKey가 없으면 Firebase를 초기화하지 않음 (MOCK_MODE 또는 env 미설정 환경에서 crash 방지)
const hasConfig = !!import.meta.env.VITE_FIREBASE_API_KEY
const app = hasConfig ? initializeApp(firebaseConfig) : null

export const auth = hasConfig ? getAuth(app!) : null!
export const db = hasConfig ? getFirestore(app!) : null!
