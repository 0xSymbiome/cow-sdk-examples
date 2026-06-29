import { useEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  // Shown when `value` matches no option (e.g. an unsupported network).
  placeholder?: string
  // Extra class on the trigger button, for callers that need a different shell.
  triggerClassName?: string
}

// A themed dropdown. A native <select> can't style its option popup to match a
// dark theme, so this renders a styled menu instead. Closes on outside click or
// Escape, and mirrors the native keyboard affordances enough for a demo.
export function Select({ value, options, onChange, ariaLabel, placeholder, triggerClassName }: SelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((option) => option.value === value)

  return (
    <div className="select" ref={ref}>
      <button
        type="button"
        className={`select-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{selected?.label ?? placeholder ?? ''}</span>
        <span className="chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <ul className="select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                className={`select-option${option.value === value ? ' select-option-active' : ''}`}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
