import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Cow } from './Cow'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

// A last line of defence: if anything below throws while rendering, show the cow
// apologising instead of a blank page.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <CowErrorScreen
          title="Something went sideways"
          detail="The interface hit an unexpected error. A reload usually sorts it out."
          onReload={() => window.location.reload()}
        />
      )
    }
    return this.props.children
  }
}

interface CowErrorScreenProps {
  title: string
  detail: string
  onReload?: () => void
}

// The shared crash face — used by the error boundary and by a failed WASM start.
export function CowErrorScreen({ title, detail, onReload }: CowErrorScreenProps) {
  return (
    <div className="cow-error" role="alert">
      <Cow mood="worried" size={96} />
      <h1>{title}</h1>
      <p>{detail}</p>
      {onReload ? (
        <button type="button" className="cow-error-reload" onClick={onReload}>
          Reload
        </button>
      ) : null}
    </div>
  )
}
