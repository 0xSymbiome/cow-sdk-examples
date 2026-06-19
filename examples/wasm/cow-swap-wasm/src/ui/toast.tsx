import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

import { Cow, type CowMood } from './Cow'

export interface Toast {
  id: number
  title: string
  detail?: string
  tone: 'info' | 'success' | 'danger'
}

interface ToastApi {
  toasts: Toast[]
  push: (toast: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

const TONE_MOOD: Record<Toast['tone'], CowMood> = {
  info: 'happy',
  success: 'celebrating',
  danger: 'worried',
}

const ToastContext = createContext<ToastApi | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId++
      setToasts((current) => [...current, { ...toast, id }])
      window.setTimeout(() => dismiss(id), 6_000)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])

  return (
    <ToastContext value={api}>
      {children}
      <ToastViewport />
    </ToastContext>
  )
}

function ToastViewport() {
  const { toasts, dismiss } = useToast()
  return (
    <div className="toast-viewport">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast-${toast.tone}`}
          onClick={() => dismiss(toast.id)}
        >
          <Cow mood={TONE_MOOD[toast.tone]} size={26} className="toast-cow" />
          <span className="toast-text">
            <strong>{toast.title}</strong>
            {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
          </span>
        </button>
      ))}
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = use(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
