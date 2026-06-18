import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner small /> : null}
      {children}
    </button>
  )
}

export function Spinner({ small = false }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-hidden="true" />
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'pending'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
