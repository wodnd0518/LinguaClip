import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: 32, fontFamily: 'monospace' }}>
          <h2 style={{ color: 'red' }}>앱 오류 — 아래 내용을 공유해주세요</h2>
          <pre style={{ background: '#fee', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {err.message}{'\n\n'}{err.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
