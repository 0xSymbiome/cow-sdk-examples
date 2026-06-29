import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import { ensureCowReady } from './lib/cow'
import { CowErrorScreen, ErrorBoundary } from './ui/ErrorBoundary'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

const root = createRoot(container)

// The web build instantiates wasm on `initialize()`, so render only after it
// resolves (it resolves immediately on bundler/nodejs, so the same entry works
// everywhere). If init fails, the cow says so rather than leaving a blank page.
void ensureCowReady().then(
  () => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    )
  },
  (error: unknown) => {
    console.error('Failed to initialise the WASM SDK', error)
    root.render(
      <StrictMode>
        <CowErrorScreen
          title="Couldn't start the demo"
          detail="The WebAssembly SDK failed to load. Check your connection and reload the page."
          onReload={() => window.location.reload()}
        />
      </StrictMode>,
    )
  },
)
