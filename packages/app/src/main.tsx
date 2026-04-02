import React, { useCallback, useEffect, useState, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router'
import { LoadingScreen } from '@/components/LoadingScreen'
import { LoginPage } from '@/components/LoginPage'
import { HomePage } from '@/components/HomePage'
import { ChatPage } from '@/components/ChatPage'
import { ThreadViewPage } from '@/components/ThreadViewPage'
import { SettingsPage } from '@/components/SettingsPage'
import { CreateProjectPage } from '@/components/CreateProjectPage'
import { FilePreviewPage } from '@/components/FilePreviewPage'
import { FileBrowserPage } from '@/components/FileBrowserPage'
import { CronPage } from '@/components/CronPage'
import { AppSidebar } from '@/components/AppSidebar'
import { WebSocketProvider } from '@/hooks/WebSocketContext'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { checkAuthStatus, verifyToken, setToken, clearToken, getToken } from '@/lib/auth'
import { cn } from '@/lib/utils'
import './index.css'

const SIDEBAR_MIN = 160
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 224

function AppLayout({
  children,
  onUnauthorized,
}: {
  children: React.ReactNode
  onUnauthorized?: () => void
}) {
  const isDesktop = useIsDesktop()
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebar-width')
      if (stored) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parseInt(stored, 10)))
    } catch { /* ignore */ }
    return SIDEBAR_DEFAULT
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    setIsDragging(true)
    e.preventDefault()
  }, [sidebarWidth])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN,
        dragRef.current.startWidth + e.clientX - dragRef.current.startX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN,
        dragRef.current.startWidth + e.clientX - dragRef.current.startX))
      try { localStorage.setItem('sidebar-width', String(newWidth)) } catch { /* ignore */ }
      dragRef.current = null
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  return (
    <div className={cn('h-dvh flex', isDragging && 'select-none cursor-col-resize')}>
      {isDesktop && <AppSidebar onUnauthorized={onUnauthorized} style={{ width: sidebarWidth }} />}
      {isDesktop && (
        <div
          className="relative shrink-0 w-1 cursor-col-resize group/divider z-10"
          onMouseDown={handleMouseDown}
        >
          <div className={cn(
            'absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-primary/40 rounded-full transition-opacity',
            isDragging ? 'opacity-100' : 'opacity-0 group-hover/divider:opacity-100',
          )} />
        </div>
      )}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {children}
      </main>
    </div>
  )
}

function AppRoutes() {
  const navigate = useNavigate()
  const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'authenticated'>('loading')

  const checkAuth = useCallback(async () => {
    // Check for token in URL (from CLI auto-login)
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      const isValid = await verifyToken(urlToken)
      if (isValid) {
        setToken(urlToken)
        window.history.replaceState({}, '', window.location.pathname)
        setAuthState('authenticated')
        return
      }
    }

    // Check server auth status
    const { hasToken: serverHasToken } = await checkAuthStatus()
    if (!serverHasToken) {
      // Server has no token configured — treat as open access
      setAuthState('authenticated')
      return
    }

    // Server has token — validate ours
    const token = getToken()
    if (token) {
      const valid = await verifyToken(token)
      setAuthState(valid ? 'authenticated' : 'unauthenticated')
    } else {
      setAuthState('unauthenticated')
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const handleLogin = useCallback(() => {
    setAuthState('authenticated')
  }, [])

  const handleUnauthorized = useCallback(() => {
    clearToken()
    setAuthState('unauthenticated')
    navigate('/login')
  }, [navigate])

  if (authState === 'loading') {
    return <LoadingScreen />
  }

  if (authState === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/file-preview" element={<FilePreviewPage />} />
      <Route path="/files" element={<FileBrowserPage />} />
      <Route path="*" element={
        <AppLayout onUnauthorized={handleUnauthorized}>
          <Routes>
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/chat" element={<ChatPage onUnauthorized={handleUnauthorized} />} />
            <Route path="/thread" element={<ThreadViewPage onUnauthorized={handleUnauthorized} />} />
            <Route path="/settings" element={<SettingsPage onUnauthorized={handleUnauthorized} />} />
            <Route path="/projects/new" element={<CreateProjectPage onUnauthorized={handleUnauthorized} />} />
            <Route path="/cron" element={<CronPage onUnauthorized={handleUnauthorized} />} />
            <Route path="/" element={<HomePage onUnauthorized={handleUnauthorized} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      } />
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <WebSocketProvider>
        <AppRoutes />
      </WebSocketProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
