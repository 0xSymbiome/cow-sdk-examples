import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

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
          <strong>{toast.title}</strong>
          {toast.detail ? <span>{toast.detail}</span> : null}
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
